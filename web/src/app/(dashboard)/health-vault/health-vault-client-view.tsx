'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUiMode } from '@/context/ui-mode-context';
import { useLanguage } from '@/context/language-context';
import { format } from '@/lib/i18n/format';
import { createClient } from '@/lib/supabase/client';
import FolderCarousel from '@/components/health-vault/folder-carousel';
import { useDensity } from '@/context/density-context';
import { useBackHandler, useFocusTask } from '@/hooks/use-back-handler';
import ZoomableImage from '@/components/health-vault/zoomable-image';
import {
  VAULT_ACCEPT_ATTR,
  VAULT_ALLOWED_LABEL,
  VAULT_CAMERA_ACCEPT,
  VAULT_MAX_BYTES,
  VAULT_MAX_FILES,
  atLimit,
  oversizeReason,
  unsupportedTypeReason,
  vaultFullCopy,
  vaultUsageCopy,
} from '@/lib/health-vault/limits';
import { compressImage } from '@/lib/health-vault/compress-image';
import { 
  FileText, 
  ClipboardList, 
  ScanLine,
  FileHeart, 
  FolderHeart,
  Lock,
  ShieldCheck,
  UploadCloud,
  X,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Calendar,
  Edit,
  Loader2,
  Upload,
  Download,
  FolderOpen,
  Eye,
  Search,
  Trash2,
  RotateCcw,
  Trash,
  Camera
} from 'lucide-react';

interface Category {
  id: string;
  name: string;
  is_default: boolean;
  created_at?: string;
  health_records?: { count: number }[] | { count: number } | any;
}

interface HealthVaultClientViewProps {
  categories: Category[];
  userRole: 'PATIENT' | 'CAREGIVER';
  patientName: string;
  patientId?: string;
}

const LIMIT = 20;

// Map a file extension to a correct MIME type. The browser's File.type is often empty on mobile
// or for some files; storing the right content-type lets the signed URL render inline (esp. PDFs).
//
// DELIBERATELY WIDER THAN VAULT_ALLOWED_EXTENSIONS, and must stay that way. New uploads are
// images and PDFs only (2026-08-13), but .doc/.docx/.txt/.zip files uploaded before that are
// still in the bucket and still have to open. This map serves READING; the allow-list serves
// WRITING. Trimming this one to match would break documents people already stored.
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
};

const getExt = (name: string) => (name.split('.').pop() || '').toLowerCase();

const mimeFor = (fileName: string, fallbackType?: string | null) =>
  MIME_BY_EXT[getExt(fileName)] || (fallbackType && fallbackType !== '' ? fallbackType : 'application/octet-stream');

// Decide how to preview, primarily by extension (robust across devices) then MIME.
type PreviewKind = 'image' | 'pdf' | 'text' | 'other';
const previewKindOf = (fileName: string, fileType?: string | null): PreviewKind => {
  const ext = getExt(fileName);
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(ext) || fileType?.startsWith('image/')) return 'image';
  if (ext === 'pdf' || fileType === 'application/pdf') return 'pdf';
  if (ext === 'txt' || fileType?.startsWith('text/')) return 'text';
  return 'other';
};

export default function HealthVaultClientView({
  categories,
  userRole,
  patientName,
  patientId,
}: HealthVaultClientViewProps) {
  const { isElderly } = useUiMode();
  const { t } = useLanguage();
  const router = useRouter();
  const supabase = createClient();

  const [mounted, setMounted] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  /**
   * How full the vault is, read from `vault_object_count()` — the SAME function
   * the RLS policy enforces with. Not a count of health_records rows: those and
   * the bucket can disagree (a trashed record keeps its object; a direct API
   * upload creates an object and no row), and a counter that disagrees with the
   * limit is worse than no counter at all.
   *
   * null = not read yet. The upload controls stay ENABLED while it is null, so a
   * failed or slow count never locks someone out of their own vault — the server
   * is the thing that actually refuses, and it does not need our help.
   */
  const [vaultUsed, setVaultUsed] = useState<number | null>(null);
  const [vaultTrashed, setVaultTrashed] = useState(0);
  const isFull = vaultUsed !== null && atLimit(vaultUsed);

  // Folder Timeline view state
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [totalRecordsCount, setTotalRecordsCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [recordsError, setRecordsError] = useState<string | null>(null);

  // Recent documents for the folder-grid screen. Records were only ever fetched once a
  // folder was open, so the first thing you saw on opening the vault was a title, a
  // paragraph, a CTA and a privacy notice — and not one of your own documents.
  const [recentRecords, setRecentRecords] = useState<any[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);

  // Search and Trash States
  const [searchQuery, setSearchQuery] = useState('');
  const [viewingTrash, setViewingTrash] = useState(false);

  // Edit Metadata Modal State
  const [recordToEdit, setRecordToEdit] = useState<any | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Permanent Delete Modal State
  const [recordToPermanentlyDelete, setRecordToPermanentlyDelete] = useState<any | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDeletingPermanently, setIsDeletingPermanently] = useState(false);

  // Upload Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Form Field State
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  /** True while a photo is being resized — decoding a 12 MP image is not instant. */
  const [isPreparingFile, setIsPreparingFile] = useState(false);
  /** Original byte size when compression actually shrank the file; null otherwise. */
  const [compressedFrom, setCompressedFrom] = useState<number | null>(null);
  /** True when the current file came from Take photo, so Retake can reopen the camera. */
  const [fromCamera, setFromCamera] = useState(false);
  /**
   * Object URL for the CHECK-IT-FIRST preview.
   *
   * A phone camera in a clinic corridor produces blurred and half-framed shots
   * routinely, and a vault that holds five files cannot afford one of them being
   * an unreadable photo of a thumb. Nothing counts against the limit until the
   * upload actually happens, so this is the moment to look before spending a
   * slot — and the moment a retake is free.
   */
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [recordDate, setRecordDate] = useState<string>('');
  const [recordTitle, setRecordTitle] = useState<string>('');

  // Preview Modal State
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Close is a two-step: `previewClosing` plays the exit animation, THEN state clears
  // and the node unmounts. Without it, closing snapped — open faded, close blinked.
  const [previewClosing, setPreviewClosing] = useState(false);
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  // Storage path of the open preview, kept so we can re-sign before the signed
  // URL's TTL expires while the user is still reading (e.g. a large PDF).
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  /**
   * Whether to offer "Take photo" as its own door.
   *
   * Inside the app always — that is where a patient photographs a paper
   * prescription, and it is the reason this feature exists. In a browser, only
   * on a coarse pointer: `capture` is ignored on desktop, so the button would
   * open a file browser under a label promising a camera, which is worse than
   * not offering it.
   *
   * Resolved after mount because `matchMedia` does not exist on the server, and
   * defaults to false so the first paint matches the server's.
   */
  const { isApp } = useDensity();
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    try { setCoarsePointer(window.matchMedia('(pointer: coarse)').matches); } catch { /* older webview */ }
  }, []);
  const showCamera = isApp || coarsePointer;

  /**
   * Re-read the two numbers behind "N of 5 used". Called after every upload,
   * delete, restore and purge, because each one moves the count and a stale
   * counter is exactly the thing that makes someone delete a second file for no
   * reason.
   *
   * Never surfaces an error. If the count cannot be read the counter simply
   * hides; the limit is still enforced in the database, and a red banner about a
   * failed count would be alarming without being actionable.
   */
  const refreshUsage = React.useCallback(async () => {
    // A caregiver is looking at someone else's vault. `vault_object_count()`
    // answers only about the CALLER, so showing it here would print the
    // caregiver's own usage under the patient's name.
    if (userRole === 'CAREGIVER' || patientId) return;
    try {
      const [{ data: used }, { count: trashed }] = await Promise.all([
        supabase.rpc('vault_object_count'),
        supabase
          .from('health_records')
          .select('id', { count: 'exact', head: true })
          .not('deleted_at', 'is', null),
      ]);
      if (typeof used === 'number') setVaultUsed(used);
      setVaultTrashed(trashed ?? 0);
    } catch {
      /* counter hides; the database is still the limit */
    }
  }, [supabase, userRole, patientId]);

  useEffect(() => {
    setMounted(true);
    async function getSession() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    }
    getSession();
    refreshUsage();

    const today = new Date().toISOString().split('T')[0];
    setRecordDate(today);
  }, [supabase, refreshUsage]);

  // Fetch timeline records when viewing mode, category, page, or search query changes
  useEffect(() => {
    if (selectedCategory) {
      const delayDebounceFn = setTimeout(() => {
        setRecords([]);
        setTotalRecordsCount(0);
        setCurrentPage(0);
        fetchRecords(selectedCategory.id, 0, false);
      }, searchQuery.trim() ? 400 : 0); // Debounce if typing, run instantly otherwise

      return () => clearTimeout(delayDebounceFn);
    } else {
      setRecords([]);
      setTotalRecordsCount(0);
    }
  }, [selectedCategory, viewingTrash, searchQuery]);

  // Newest documents across every real folder, for the grid screen. Placeholder
  // `default-` categories are not rows in the table, so they are filtered out — passing
  // them to .in() would match nothing and quietly return an empty list.
  useEffect(() => {
    if (selectedCategory) return;
    const realIds = categories.filter(c => !c.id.startsWith('default-')).map(c => c.id);
    if (realIds.length === 0) {
      setRecentRecords([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoadingRecent(true);
      const { data, error } = await supabase
        .from('health_records')
        .select('id, title, record_date, file_name, file_url, file_type, file_size, category_id')
        .in('category_id', realIds)
        .is('deleted_at', null)
        .order('record_date', { ascending: false })
        .limit(6);
      if (cancelled) return;
      // supabase-js resolves rather than rejects on a Postgres error, so this has to be
      // checked explicitly or a failure silently renders as "no documents yet".
      if (error) {
        console.error('[Health Vault] recent records failed:', error.message);
        setRecentRecords([]);
      } else {
        setRecentRecords(data || []);
      }
      setIsLoadingRecent(false);
    })();
    return () => { cancelled = true; };
  }, [selectedCategory, categories, supabase]);

  const fetchRecords = async (categoryId: string, page: number, append: boolean = false) => {
    setIsLoadingRecords(true);
    setRecordsError(null);
    try {
      const from = page * LIMIT;
      const to = from + LIMIT - 1;

      let query = supabase
        .from('health_records')
        .select('id, title, record_date, file_name, file_url, file_type, file_size, uploaded_at', { count: 'exact' })
        .eq('category_id', categoryId);

      // Filter by soft-delete state
      if (viewingTrash) {
        query = query.not('deleted_at', 'is', null);
      } else {
        query = query.is('deleted_at', null);
      }

      // Filter by case-insensitive text search (Title or File name)
      if (searchQuery.trim()) {
        query = query.or(`title.ilike.%${searchQuery.trim()}%,file_name.ilike.%${searchQuery.trim()}%`);
      }

      query = query.order('record_date', { ascending: false }).range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      if (append) {
        setRecords((prev) => [...prev, ...(data || [])]);
      } else {
        setRecords(data || []);
      }

      if (count !== null) {
        setTotalRecordsCount(count);
      }
    } catch (err: any) {
      console.error('[TIMELINE_FETCH_ERROR]', err);
      setRecordsError(t.vault.errTimeline);
    } finally {
      setIsLoadingRecords(false);
    }
  };

  const handleLoadMore = () => {
    if (!selectedCategory) return;
    const nextPage = currentPage + 1;
    setCurrentPage(nextPage);
    fetchRecords(selectedCategory.id, nextPage, true);
  };

  // Safe signed-url download trigger
  const handleDownload = async (path: string, fileName: string) => {
    try {
      const { data, error } = await supabase.storage
        .from('health-vault')
        .createSignedUrl(path, 60, { download: fileName });

      if (error) throw error;

      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = fileName;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download error:', err);
      alert(t.vault.errDownloadLink);
    }
  };

  // Trigger a browser download from an already-signed URL (used inside the preview modal).
  const handleDownloadUrl = (url: string, fileName: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Safe signed-url preview trigger
  const PREVIEW_URL_TTL = 600; // seconds
  const handlePreview = async (path: string, type: string, title: string, fileName: string) => {
    try {
      // Longer TTL so the "Open in new tab" link is still valid if tapped a bit later,
      // and force inline rendering so PDFs open in the browser's native viewer rather than
      // downloading. The MIME is derived from the file name extension for reliability.
      const { data, error } = await supabase.storage
        .from('health-vault')
        .createSignedUrl(path, PREVIEW_URL_TTL, { download: false });

      if (error) throw error;

      setPreviewUrl(data.signedUrl);
      setPreviewType(mimeFor(fileName, type));
      setPreviewTitle(title);
      setPreviewName(fileName);
      setPreviewPath(path); // enables auto-refresh of the signed URL (see effect below)
    } catch (err) {
      console.error('Preview generation error:', err);
      alert(t.vault.errPreview);
    }
  };

  const closePreview = () => {
    if (previewClosing) return;
    setPreviewClosing(true);
    setTimeout(() => {
      setPreviewUrl(null);
      setPreviewType(null);
      setPreviewTitle(null);
      setPreviewName(null);
      setPreviewPath(null); // stops the signed-URL auto-refresh effect
      setPreviewClosing(false);
    }, 200);
  };

  // Escape closes, and the page behind must not scroll while a document is open —
  // on mobile the modal is near-fullscreen and background scroll reads as breakage.
  useEffect(() => {
    if (!previewUrl) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl]);

  /**
   * HARDWARE BACK, FOR EVERY OVERLAY ON THIS PAGE.
   *
   * None of these change the URL, so `AndroidBack` could not see any of them and
   * the Android back button navigated the webview out from under whatever was
   * open. On the document viewer — which fills the screen — that left no exit at
   * all. Registered in opening order; the registry runs the most recent first, so
   * a dialog opened on top of a viewer inside a folder unwinds the way it was
   * built. See lib/navigation/back-stack.ts.
   *
   * Declared AFTER `closePreview` on purpose: these are const arrow functions, so
   * referencing one from a hook call placed above it is a TDZ crash at render.
   */
  useBackHandler(previewUrl !== null, closePreview);
  useBackHandler(recordToEdit !== null, () => setRecordToEdit(null));
  useBackHandler(recordToPermanentlyDelete !== null, () => setRecordToPermanentlyDelete(null));
  useBackHandler(isModalOpen, () => {
    // Back inside the wizard steps BACKWARD through it rather than discarding the
    // whole upload — losing a chosen photo to one stray back press is the kind of
    // thing that makes people stop trusting the button.
    if (activeStep > 1) setActiveStep((s) => (s - 1) as 1 | 2 | 3 | 4);
    else setIsModalOpen(false);
  });
  useBackHandler(viewingTrash, () => setViewingTrash(false));
  useBackHandler(selectedCategory !== null, () => setSelectedCategory(null));

  /* The upload wizard owns the screen while it is open, so the floating bottom nav
     must stop competing for the bottom edge — same class of bug as the dose gate,
     two fixed elements and no shared intent. */
  useFocusTask(isModalOpen);

  // Re-sign the preview URL before its TTL expires so an open document (e.g. a
  // large PDF being read) doesn't break mid-session with a 403. Runs only while
  // a preview is open; refreshes at ~90% of the TTL.
  useEffect(() => {
    if (!previewPath) return;
    const intervalMs = PREVIEW_URL_TTL * 0.9 * 1000;
    const timer = setInterval(async () => {
      try {
        const { data, error } = await supabase.storage
          .from('health-vault')
          .createSignedUrl(previewPath, PREVIEW_URL_TTL, { download: false });
        if (error) throw error;
        setPreviewUrl(data.signedUrl);
      } catch (err) {
        console.error('Preview URL refresh error:', err);
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [previewPath]);

  // Soft Delete handler
  const handleSoftDelete = async (recordId: string) => {
    if (!confirm(t.vault.confirmTrash)) return;
    try {
      const { error } = await supabase
        .from('health_records')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', recordId);

      if (error) throw error;

      // Log compliance audit trace on client side
      await supabase.from('audit_logs').insert([{
        user_id: userId,
        action: 'SOFT_DELETE_RECORD',
        details: { record_id: recordId }
      }]);

      setRecords((prev) => prev.filter((r) => r.id !== recordId));
      setTotalRecordsCount((prev) => Math.max(0, prev - 1));
      // Moves the file into "in trash" — it does NOT free a slot, because the
      // object stays in the bucket so Restore can work. The counter has to say
      // so, or someone deletes a second file wondering why nothing changed.
      void refreshUsage();
      router.refresh();
    } catch (err) {
      console.error('Soft delete error:', err);
      alert(t.vault.errDelete);
    }
  };

  // Restore from Trash handler
  const handleRestore = async (recordId: string) => {
    try {
      const { error } = await supabase
        .from('health_records')
        .update({ deleted_at: null })
        .eq('id', recordId);

      if (error) throw error;

      // Log compliance audit trace
      await supabase.from('audit_logs').insert([{
        user_id: userId,
        action: 'RESTORE_RECORD',
        details: { record_id: recordId }
      }]);

      setRecords((prev) => prev.filter((r) => r.id !== recordId));
      setTotalRecordsCount((prev) => Math.max(0, prev - 1));
      void refreshUsage();
      router.refresh();
    } catch (err) {
      console.error('Restore error:', err);
      alert(t.vault.errRestore);
    }
  };

  // Permanent Hard Delete handler
  const handlePermanentDelete = async () => {
    if (!recordToPermanentlyDelete) return;
    if (deleteConfirmationText.trim().toUpperCase() !== 'DELETE') {
      alert(format(t.vault.errTypeDelete, { token: t.vault.confirmToken }));
      return;
    }

    setIsDeletingPermanently(true);
    try {
      // 1. Remove binary object from storage bucket
      const { error: storageError } = await supabase.storage
        .from('health-vault')
        .remove([recordToPermanentlyDelete.file_url]);

      if (storageError) {
        console.warn('Storage delete warning (continuing to clear DB row):', storageError.message);
      }

      // 2. Clear metadata row from database
      const { error: dbError } = await supabase
        .from('health_records')
        .delete()
        .eq('id', recordToPermanentlyDelete.id);

      if (dbError) throw dbError;

      // 3. Log compliance audit trace (required for medical records)
      await supabase.from('audit_logs').insert([{
        user_id: userId,
        action: 'MANUAL_PERMANENT_DELETE',
        details: {
          record_id: recordToPermanentlyDelete.id,
          file_name: recordToPermanentlyDelete.file_name,
          title: recordToPermanentlyDelete.title,
          file_url: recordToPermanentlyDelete.file_url
        }
      }]);

      setRecords((prev) => prev.filter((r) => r.id !== recordToPermanentlyDelete.id));
      setTotalRecordsCount((prev) => Math.max(0, prev - 1));
      setRecordToPermanentlyDelete(null);
      setDeleteConfirmationText('');
      // THIS is the one that frees a slot — the object leaves the bucket here.
      void refreshUsage();
      router.refresh();
    } catch (err: any) {
      console.error('Permanent delete error:', err);
      alert(t.vault.errPermanentDelete);
    } finally {
      setIsDeletingPermanently(false);
    }
  };

  // Metadata Edit Save handler
  const handleSaveEdit = async () => {
    if (!recordToEdit) return;
    if (!editTitle.trim()) {
      alert(t.vault.errTitleRequired);
      return;
    }
    if (!editDate) {
      alert(t.vault.errDateRequired);
      return;
    }
    if (!editCategoryId) {
      alert(t.vault.errCategoryRequired);
      return;
    }

    setIsSavingEdit(true);
    try {
      const { error } = await supabase
        .from('health_records')
        .update({
          title: editTitle.trim(),
          record_date: editDate,
          category_id: editCategoryId
        })
        .eq('id', recordToEdit.id);

      if (error) throw error;

      // Log compliance audit trace
      await supabase.from('audit_logs').insert([{
        user_id: userId,
        action: 'EDIT_RECORD_METADATA',
        details: {
          record_id: recordToEdit.id,
          old_title: recordToEdit.title,
          new_title: editTitle.trim(),
          old_date: recordToEdit.record_date,
          new_date: editDate,
          old_category_id: selectedCategory?.id,
          new_category_id: editCategoryId
        }
      }]);

      // If record is moved to another category, hide it from the current timeline
      if (selectedCategory && editCategoryId !== selectedCategory.id) {
        setRecords((prev) => prev.filter((r) => r.id !== recordToEdit.id));
        setTotalRecordsCount((prev) => Math.max(0, prev - 1));
      } else {
        setRecords((prev) =>
          prev.map((r) =>
            r.id === recordToEdit.id
              ? { ...r, title: editTitle.trim(), record_date: editDate }
              : r
          )
        );
      }

      setRecordToEdit(null);
      router.refresh();
    } catch (err: any) {
      console.error('Error saving metadata edit:', err);
      alert(t.vault.errSaveChanges);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const openEditModal = (record: any) => {
    setRecordToEdit(record);
    setEditTitle(record.title);
    setEditDate(record.record_date);
    setEditCategoryId(selectedCategory?.id || '');
  };

  // Grouping timeline: Year -> Date group -> items
  const formatDateLabel = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return dateObj.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  };

  const getGroupedTimeline = (recordsList: any[]) => {
    const groups: { [year: string]: { [date: string]: any[] } } = {};
    
    recordsList.forEach((record) => {
      const year = record.record_date.split('-')[0];
      const dateLabel = formatDateLabel(record.record_date);
      
      if (!groups[year]) {
        groups[year] = {};
      }
      if (!groups[year][dateLabel]) {
        groups[year][dateLabel] = [];
      }
      groups[year][dateLabel].push(record);
    });
    
    const sortedYears = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    
    return sortedYears.map((year) => {
      const yearData = groups[year];
      const sortedDates = Object.keys(yearData).sort((a, b) => {
        const itemA = yearData[a][0];
        const itemB = yearData[b][0];
        return itemB.record_date.localeCompare(itemA.record_date);
      });
      
      return {
        year,
        dates: sortedDates.map((dateLabel) => ({
          dateLabel,
          items: yearData[dateLabel]
        }))
      };
    });
  };

  const groupedTimeline = getGroupedTimeline(records);

  // Fallback categories list
  const defaultCategoryNames = ['Prescriptions', 'Lab Reports', 'Scans', 'Discharge Summaries'];
  const displayCategories = categories.length > 0 
    ? categories 
    : defaultCategoryNames.map((name, idx) => ({ id: `default-${idx}`, name, is_default: true }));

  /** "Lab Reports" → "lab report", for empty-folder prompts. */
  const singularCategory = (name: string) =>
    name.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');

  const getRecordCount = (category: Category) => {
    if (!category.health_records) return 0;
    if (Array.isArray(category.health_records)) {
      return category.health_records[0]?.count || 0;
    }
    return (category.health_records as any)?.count || 0;
  };

  /** Total across every folder, for the header's one-line summary. */
  const totalDocuments = displayCategories.reduce((sum, c) => sum + getRecordCount(c), 0);

  // Every folder used to be the same pink icon, so at a glance the vault was four
  // identical tiles and you had to read each label. A distinct hue per category makes
  // them scannable. These are deliberately drawn from the neutral/brand family, NOT the
  // status palette — a folder is not a warning. (`Binary` for scans was also just wrong;
  // ScanLine actually looks like an imaging report.)
  const CATEGORY_TINT: Record<string, string> = {
    'prescriptions': 'bg-primary/10 text-primary',
    'lab reports': 'bg-info/10 text-info',
    'scans': 'bg-accent-surface text-accent-surface-foreground',
    'discharge summaries': 'bg-muted text-foreground',
  };

  const getCategoryTint = (name: string) =>
    CATEGORY_TINT[name.toLowerCase()] ?? 'bg-muted text-muted-foreground';

  const getCategoryIcon = (name: string, isElderlyMode: boolean) => {
    const iconClass = isElderlyMode ? "w-10 h-10 shrink-0" : "w-6 h-6 shrink-0";
    switch (name.toLowerCase()) {
      case 'prescriptions':
        return <FileText className={iconClass} />;
      case 'lab reports':
        return <ClipboardList className={iconClass} />;
      case 'scans':
        return <ScanLine className={iconClass} />;
      case 'discharge summaries':
        return <FileHeart className={iconClass} />;
      default:
        return <FolderHeart className={iconClass} />;
    }
  };

  // Upload handlers
  /**
   * One path for both entry points (browse and drop): check the TYPE of what was
   * picked, shrink it if it is a photo, then check the size of what would
   * actually be uploaded.
   *
   * The order is the point. Type first, on the original — compression rewrites a
   * photo to .jpg, so checking afterwards would let a disallowed image type
   * launder itself into an allowed one. Size last, on the result — checking a
   * 9 MB camera photo before shrinking it would refuse the most ordinary thing
   * anyone does here.
   */
  const acceptFile = async (raw: File) => {
    setUploadError(null);

    const typeProblem = unsupportedTypeReason(raw.name);
    if (typeProblem) {
      setUploadError(typeProblem);
      setSelectedFile(null);
      return;
    }

    setIsPreparingFile(true);
    try {
      const file = await compressImage(raw);
      const sizeProblem = oversizeReason(file.size);
      if (sizeProblem) {
        setUploadError(sizeProblem);
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      setFilePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      });
      // Shown so nobody is startled by a 9 MB photo becoming a 700 KB one —
      // and so a document that did NOT shrink is not silently blamed later.
      setCompressedFrom(file.size < raw.size ? raw.size : null);
      const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      setRecordTitle(nameWithoutExt);
    } finally {
      setIsPreparingFile(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, viaCamera = false) => {
    setFromCamera(viaCamera);
    const file = e.target.files?.[0];
    // Cleared BEFORE handling, so picking the same file twice still fires. A
    // retake is the common case here — the first photo of a prescription is
    // blurred, and on some camera apps the retake reuses the same filename, so
    // without this the second attempt would silently do nothing.
    e.target.value = '';
    if (file) void acceptFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setUploadError(null);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void acceptFile(e.dataTransfer.files[0]);
    }
  };

  // The two upload entry points call the same handler; the only difference is whether a
  // folder is pre-chosen — which is exactly what the labels now say ("Upload Record" vs
  // "Upload to {folder}"). The generic entry used to silently default to `categories[0]`,
  // i.e. whichever folder sorted first alphabetically, and if the user had no real
  // categories yet that was an unsaveable `default-` placeholder that only failed at the
  // final Save. It now opens with nothing selected so the choice is deliberate.
  const openUploadModal = (categoryId: string = '') => {
    // Every call site disables its own button, but this is the door itself: a
    // modal that cannot succeed should not open, and a call site added later
    // should not have to remember the rule.
    if (isFull) return;
    setSelectedCategoryId(categoryId.startsWith('default-') ? '' : categoryId);
    setSelectedFile(null);
    setCompressedFrom(null);
    setFromCamera(false);
    setFilePreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setIsPreparingFile(false);
    setUploadError(null);
    setUploadSuccess(false);
    setIsUploading(false);
    setActiveStep(1);
    
    const today = new Date().toISOString().split('T')[0];
    setRecordDate(today);
    setRecordTitle('');
    setIsModalOpen(true);
  };

  /**
   * Turn a Storage API refusal into something a person can act on.
   *
   * Each of these corresponds to a rule enforced in
   * migration_vault_upload_limits_2026_08_13.sql, and reaching one means the
   * form's own check was out of date — a counter read before another device
   * uploaded, or an APK older than the current rules. Falls through to the raw
   * message for anything genuinely unexpected, because inventing friendly copy
   * for an unknown failure hides the failure.
   */
  const storageRefusalCopy = (message: string): string => {
    const m = message.toLowerCase();
    if (m.includes('row-level security') || m.includes('unauthorized')) {
      return vaultFullCopy(vaultUsed ?? VAULT_MAX_FILES, vaultTrashed);
    }
    if (m.includes('maximum allowed size') || m.includes('payload too large') || m.includes('entity too large')) {
      return `Each document needs to be under ${(VAULT_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB.`;
    }
    if (m.includes('mime') || m.includes('content type') || m.includes('invalid_mime_type')) {
      return `The vault takes ${VAULT_ALLOWED_LABEL} files.`;
    }
    return message;
  };

  const handleUploadSave = async () => {
    if (!userId) {
      setUploadError(t.vault.errSessionExpired);
      return;
    }
    if (!selectedFile) {
      setUploadError(t.vault.errSelectFile);
      return;
    }
    // Re-checked here and not only at the modal's door: the count may have moved
    // since it opened — the same account on a second device, or a file restored
    // from the trash. Cheap, and it saves an upload that would be refused.
    if (isFull) {
      setUploadError(vaultFullCopy(vaultUsed ?? VAULT_MAX_FILES, vaultTrashed));
      return;
    }
    if (!selectedCategoryId || selectedCategoryId.startsWith('default-')) {
      setUploadError(t.vault.errValidFolder);
      return;
    }
    if (!recordTitle.trim()) {
      setUploadError(t.vault.errTitleRequired);
      return;
    }
    if (!recordDate) {
      setUploadError(t.vault.errDateRequired);
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const fileExt = selectedFile.name.split('.').pop();
      const sanitizedName = selectedFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const uniquePath = `${userId}/${selectedCategoryId}/${Date.now()}-${sanitizedName}`;

      const { data: storageData, error: storageError } = await supabase.storage
        .from('health-vault')
        .upload(uniquePath, selectedFile, {
          cacheControl: '3600',
          upsert: false,
          // Store the correct content-type (derived from extension when the browser omits it),
          // so the file renders inline in the native viewer instead of downloading.
          contentType: mimeFor(selectedFile.name, selectedFile.type),
        });

      if (storageError) {
        // The server is the real limit, so its refusals reach the user in the
        // same words the form uses — otherwise someone who slipped past a stale
        // counter gets "new row violates row-level security policy", which is
        // true, unreadable, and sounds like their account is broken.
        throw new Error(storageRefusalCopy(storageError.message));
      }

      const { error: dbError } = await supabase
        .from('health_records')
        .insert([{
          user_id: userId,
          category_id: selectedCategoryId,
          title: recordTitle.trim(),
          record_date: recordDate,
          file_name: selectedFile.name,
          file_url: storageData.path,
          file_type: mimeFor(selectedFile.name, selectedFile.type),
          file_size: selectedFile.size,
        }]);

      if (dbError) {
        await supabase.storage.from('health-vault').remove([uniquePath]);
        throw new Error(format(t.vault.errDatabase, { detail: dbError.message }));
      }

      // Log upload action
      await supabase.from('audit_logs').insert([{
        user_id: userId,
        action: 'UPLOAD_RECORD',
        details: {
          file_name: selectedFile.name,
          title: recordTitle.trim(),
          category_id: selectedCategoryId
        }
      }]);

      setUploadSuccess(true);
      void refreshUsage();
      router.refresh();

      if (selectedCategory && selectedCategory.id === selectedCategoryId) {
        fetchRecords(selectedCategoryId, 0, false);
      }

      setTimeout(() => {
        setIsModalOpen(false);
      }, 1500);

    } catch (err: any) {
      console.error('[UPLOAD_ERROR]', err);
      setUploadError(err.message || 'Upload process failed.');
    } finally {
      setIsUploading(false);
    }
  };

  if (!mounted) {
    return (
      <div className="h-[200px] w-full bg-muted/20 animate-pulse rounded-2xl flex items-center justify-center text-xs text-muted-foreground font-semibold">
        Loading Health Vault...
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* ---------------------------------------------------- */}
      {/* GRID VIEW (No Category Selected) */}
      {/* ---------------------------------------------------- */}
      {!selectedCategory ? (
        <>
          {/* Compact header. The old one spent the whole first screen on chrome — a large
              title, a three-line paragraph, a full-width CTA and a privacy card — before a
              single document appeared. The paragraph explained what a vault is to someone
              already standing in it; upload moved to the FAB below. */}
          {/* The title carried the whole header at 20px, with nothing under it — the page
              opened without telling you what was in the vault. 26px matches the other
              page titles, and the line beneath answers "is there anything in here?"
              before you have scrolled anything. */}
          <div className="rise-in flex items-start justify-between gap-3">
            <div className="min-w-0">
              {/* BETA, on the title itself rather than in a banner.
                  It belongs where the feature is named, so it is read every time
                  the page is opened and cannot be dismissed and forgotten — this
                  is the surface that holds people's medical records, and "still
                  being built" is a fact they should have in front of them while
                  deciding what to upload.

                  A mono uppercase micro-label: structural, which is the one thing
                  mono is for (§4). `--warning` tinted with `-strong` text, because
                  it is text on a tint and the plain token fails 4.5:1 there. Not
                  pink — pink is the accent and only ever marks something you can
                  touch, and this is a state, not a control. */}
              <h1 className={`font-extrabold text-foreground tracking-[-0.02em] flex items-center gap-2 flex-wrap ${isElderly ? 'text-3xl' : 'text-[26px]'}`}>
                {userRole === 'CAREGIVER' ? `${patientName}'s documents` : 'Health Vault'}
                <span
                  className={`shrink-0 font-mono uppercase tracking-[0.08em] font-semibold rounded-[var(--r-chip)] bg-warning/15 text-warning-strong ${
                    isElderly ? 'text-xs px-2 py-1' : 'text-[11px] px-1.5 py-0.5'
                  }`}
                >
                  Beta
                </span>
              </h1>
              {userRole === 'CAREGIVER' ? (
                <p className="text-[11px] text-primary-strong font-bold mt-1">
                  Shared through Care Circle · read-only
                </p>
              ) : (
                <p className={`text-muted-foreground font-semibold mt-1 ${isElderly ? 'text-base' : 'text-[13px]'}`}>
                  {totalDocuments === 0
                    ? 'Nothing stored yet — your records stay private to you.'
                    : `${totalDocuments} ${totalDocuments === 1 ? 'document' : 'documents'} in ${displayCategories.length} folders`}
                </p>
              )}
            </div>

            {/* "N of 5 used". Hidden until the count is read, and hidden from
                caregivers — the number describes the CALLER's own vault, so
                printing it under a patient's name would be a different person's
                usage. Quiet by default and warning-toned only when full: a
                storage counter is not news until it stops you doing something. */}
            {userRole !== 'CAREGIVER' && vaultUsed !== null && (
              <span
                className={`shrink-0 rounded-full px-3 py-1 font-mono font-bold tabular-nums ${
                  isElderly ? 'text-sm' : 'text-[11px]'
                } ${isFull
                  ? 'bg-warning/15 text-warning-strong border border-warning/30'
                  : 'bg-muted text-muted-foreground'}`}
              >
                {vaultUsageCopy(vaultUsed, vaultTrashed)}
              </span>
            )}
          </div>

          {/* The explanation, only once there is something to explain. Sentence
              case, no blame, and it names the way out rather than the rule. */}
          {userRole !== 'CAREGIVER' && isFull && (
            <div
              className="flex items-start gap-2.5 rounded-[var(--r-card)] border border-warning/35 bg-warning/10 px-4 py-3 text-warning-strong"
              role="status"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className={`font-semibold text-balance ${isElderly ? 'text-base' : 'text-xs'}`}>
                {vaultFullCopy(vaultUsed ?? VAULT_MAX_FILES, vaultTrashed)}
              </p>
            </div>
          )}

          {/* Trust banner.
              Two problems here. It wore the app's PINK — the alert/brand color — for a
              message whose whole job is to calm you down; trust messaging reads as blue
              or green, not as an alarm. And the copy was written for an engineer:
              "Row-Level Security policies (RLS)", "private object containers". Someone
              deciding whether to upload their discharge summary needs the promise, not
              the mechanism. The mechanism is still here, one tap away, for whoever wants
              it. */}
          {/* Folders as a horizontal rail with the next card deliberately peeking, so the
              swipe is discoverable without a label. Stacked full-width, four folders were
              four screens of scrolling before you reached a document. */}
          <div className="space-y-3">
            <h3 className={`font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>{t.vault.folders}</h3>

            <FolderCarousel
              isElderly={isElderly}
              onSelect={(id) => {
                const category = displayCategories.find(c => c.id === id);
                if (category) {
                  setSelectedCategory(category);
                  setViewingTrash(false);
                }
              }}
              items={displayCategories.map((category) => {
                const count = getRecordCount(category);
                return {
                  id: category.id,
                  name: category.name,
                  // The count used to print twice — "Prescriptions (0)" then "0 documents"
                  // under it. Once, and at zero say what to do instead of restating it.
                  caption:
                    count === 0
                      ? `Add your first ${singularCategory(category.name)}`
                      : `${count} ${count === 1 ? 'file' : 'files'}`,
                  icon: getCategoryIcon(category.name, true),
                  count,
                  disabled: category.id.startsWith('default-'),
                };
              })}
            />
          </div>

          {/* Recent documents — the thing you actually came for, now on the first screen. */}
          <div className="space-y-3">
            <h3 className={`font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>{t.vault.recentDocuments}</h3>

            {isLoadingRecent ? (
              <div className="space-y-2" aria-live="polite">
                {[0, 1, 2].map(i => (
                  <div key={i} className="h-14 rounded-2xl bg-muted animate-pulse" />
                ))}
                <span className="sr-only">{t.vault.loading}</span>
              </div>
            ) : recentRecords.length === 0 ? (
              <div className="rounded-[var(--r-card)] border border-dashed border-border bg-card/60 p-5 text-center">
                <p className={`font-semibold text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
                  No documents yet.
                </p>
                {userRole !== 'CAREGIVER' && (
                  <button
                    onClick={() => openUploadModal()}
                    /* Reachable while full: five documents all sitting in the
                       trash leaves this list empty and every slot taken. */
                    disabled={isFull}
                    className={`mt-2 inline-flex items-center justify-center min-h-11 px-4 rounded-xl font-black bg-primary-strong text-primary-strong-foreground transition-all ${
                      isElderly ? 'text-base' : 'text-xs'
                    } ${isFull ? 'opacity-40 cursor-not-allowed' : 'hover:bg-primary-strong-hover cursor-pointer'}`}
                  >
                    <Upload className="w-4 h-4 mr-1.5 shrink-0" /> Upload your first record
                  </button>
                )}
              </div>
            ) : (
              <ul className="space-y-2">
                {recentRecords.map((item, idx) => {
                  const ext = (getExt(item.file_name) || 'file').toUpperCase();
                  const folder = categories.find(c => c.id === item.category_id);
                  // The folder's identity hue, shown as a DOT beside the folder name so a
                  // document and the folder it came from read as the same colour.
                  //
                  // It is not used to tint the file-type chip: the four --category tokens
                  // deliberately have no `-strong` partner (globals.css says so outright)
                  // because they are built to be SOLID covers carrying white text, not
                  // text-on-tint. Measured as chip ink it lands at 1.8:1 on dark. A dot
                  // carries no text, so it has no contrast floor to clear.
                  const folderIdx = folder ? displayCategories.findIndex(c => c.id === folder.id) : -1;
                  const hue = folderIdx >= 0 ? `var(--category-${(folderIdx % 4) + 1})` : null;
                  return (
                    <li
                      key={item.id}
                      className="rise-in flex items-center gap-3 card-lift p-3 transition-colors hover:border-input"
                      style={{ ['--rise-delay' as string]: `${Math.min(idx, 6) * 60}ms` }}
                    >
                      {/* File type is metadata, not a status — a red PDF badge would read
                          as "missed dose" in this palette. */}
                      <span className={`shrink-0 flex items-center justify-center rounded-xl bg-info/15 text-info-strong font-black ${
                        isElderly ? 'w-12 h-12 text-xs' : 'w-10 h-10 text-[11px]'
                      }`}>
                        {ext.slice(0, 4)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handlePreview(item.file_url, item.file_type, item.title, item.file_name)}
                        className="flex-1 min-w-0 text-left min-h-11 cursor-pointer"
                      >
                        <span className={`block font-black text-foreground truncate ${isElderly ? 'text-base' : 'text-sm'}`}>
                          {item.title}
                        </span>
                        <span className={`flex items-center gap-1.5 font-semibold text-muted-foreground truncate ${isElderly ? 'text-sm' : 'text-[11px]'}`}>
                          {hue && (
                            <span
                              aria-hidden
                              className="shrink-0 w-2 h-2 rounded-full"
                              style={{ backgroundColor: hue }}
                            />
                          )}
                          <span className="truncate">
                            {folder?.name ? `${folder.name} · ` : ''}
                            {item.record_date ? new Date(item.record_date).toLocaleDateString() : ''}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownload(item.file_url, item.file_name)}
                        aria-label={`Download ${item.title}`}
                        className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Trust banner, now BELOW the documents. It kept its pink-to-info fix and its
              plain-language copy, but it was sitting between the header and the folders —
              a reassurance you had to scroll past every visit to reach your own files.
              Reassurance belongs where the question occurs, not ahead of the content. */}
          <div className={`bg-info-surface text-info-strong border border-info/25 rounded-[var(--r-card)] transition-all duration-300 ${
            isElderly ? 'p-6 border-2 text-lg' : 'p-4 text-xs'
          }`}>
            <div className="flex items-start gap-3">
              <ShieldCheck className={`text-info shrink-0 ${isElderly ? 'w-8 h-8' : 'w-5 h-5'}`} />
              <div>
                <h4 className="font-extrabold mb-0.5">{t.vault.privateNotice}</h4>
                <p className="font-medium">
                  Only you — and anyone you invite through Care Circle — can open these files.
                </p>
                <details className="mt-2 group/sec">
                  <summary className="cursor-pointer font-bold underline underline-offset-2 list-none marker:content-none">
                    How this works
                  </summary>
                  <p className="mt-1.5 font-medium opacity-90">
                    Files are uploaded over an encrypted connection and kept in private
                    storage that is not reachable by a public link. Database rules check
                    your identity on every read, so another account cannot list or open
                    your records even if it guesses a file name.
                  </p>
                </details>
              </div>
            </div>
          </div>

          {/* Upload as a FAB. `floating-bottom` is the shared class that clears the mobile
              dock, so it can't end up painting over the nav the way fixed offsets did. */}
          {userRole !== 'CAREGIVER' && (
            <button
              onClick={() => openUploadModal()}
              disabled={isFull}
              aria-label={isFull ? `Vault full — ${vaultFullCopy(vaultUsed ?? VAULT_MAX_FILES, vaultTrashed)}` : 'Upload a record'}
              // Disabled rather than hidden. A control that vanishes leaves you
              // hunting for a button you remember; one that is visibly out of
              // reach, next to a banner saying why, answers the question.
              className={`floating-bottom fixed right-4 z-30 w-14 h-14 rounded-full bg-primary-strong text-primary-strong-foreground shadow-lg transition-all flex items-center justify-center ${
                isFull
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-primary-strong-hover active:scale-[0.96] cursor-pointer'
              }`}
            >
              <Upload className="w-6 h-6" />
            </button>
          )}
        </>
      ) : (
        // ----------------------------------------------------
        // FOLDER DETAILED TIMELINE VIEW
        // ----------------------------------------------------
        <div className="space-y-6">
          {/* Back Navigator */}
          <button
            onClick={() => setSelectedCategory(null)}
            className="flex items-center gap-1.5 text-xs font-black text-muted-foreground hover:text-foreground cursor-pointer transition-all hover:-translate-x-0.5"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t.vault.backToFolders}</span>
          </button>

          {/* Folder Details Header Panel */}
          <div className={`flex flex-col md:flex-row md:items-center md:justify-between card-lift transition-all duration-300 gap-4 ${
            isElderly ? 'p-8 border-4 border-primary/30' : 'p-5'
          }`}>
            <div className="flex items-center gap-4">
              <div className={`p-3.5 bg-primary/10 rounded-[var(--r-control)] text-primary flex items-center justify-center`}>
                <FolderOpen className={isElderly ? "w-10 h-10" : "w-7 h-7"} />
              </div>
              <div>
                <h2 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-3xl' : 'text-xl'}`}>
                  {selectedCategory.name} {viewingTrash && '(Trash Folder)'}
                </h2>
                <p className={`text-muted-foreground ${isElderly ? 'text-lg mt-0.5' : 'text-xs'}`}>
                  {viewingTrash 
                    ? `Trash container • Loaded ${records.length} items to purge` 
                    : `Chronological history timeline • Loaded ${records.length} of ${totalRecordsCount} documents`}
                </p>
              </div>
            </div>
            {userRole !== 'CAREGIVER' && !viewingTrash && (
              <div className="shrink-0 space-y-1.5">
                <button
                  onClick={() => openUploadModal(selectedCategory.id)}
                  disabled={isFull}
                  className={`w-full font-black rounded bg-primary-strong text-primary-strong-foreground transition-all shadow-sm flex items-center justify-center ${
                    isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                  } ${isFull ? 'opacity-40 cursor-not-allowed' : 'hover:bg-primary-strong-hover cursor-pointer'}`}
                >
                  <Upload className="w-4 h-4 mr-1.5 shrink-0" />
                  <span>Upload to {selectedCategory.name}</span>
                </button>
                {isFull && (
                  <p className={`font-semibold text-warning-strong text-balance ${isElderly ? 'text-sm' : 'text-[11px]'}`}>
                    {vaultFullCopy(vaultUsed ?? VAULT_MAX_FILES, vaultTrashed)}
                  </p>
                )}
              </div>
            )}
          </div>

          {userRole === 'CAREGIVER' && (
            <div className="flex items-start gap-3.5 bg-primary/5 text-primary border border-primary/20 rounded-[var(--r-card)] p-5 text-xs">
              <ShieldCheck className="w-5 h-5 shrink-0 text-primary mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-extrabold text-sm text-foreground">Documents Shared by {patientName}</h4>
                <p className="font-bold text-primary opacity-90">{t.vault.sharedReadOnly}</p>
                <p className="text-muted-foreground mt-1.5 leading-relaxed font-semibold">
                  {patientName} has chosen to share their health documents with you. You may review prescriptions, lab reports, and medical records. All documents remain read-only.
                </p>
              </div>
            </div>
          )}

          {/* Active / Trash Toggles & Simple Search Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border border-border/60 rounded-[var(--r-card)] p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewingTrash(false)}
                className={`font-black rounded-xl transition-all cursor-pointer ${
                  !viewingTrash 
                    ? 'bg-primary-strong text-primary-strong-foreground shadow-sm' 
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                } ${isElderly ? 'px-5 py-2.5 text-sm' : 'px-3 py-1.5 text-xs'}`}
              >
                Active Records
              </button>
              <button
                onClick={() => setViewingTrash(true)}
                className={`font-black rounded-xl transition-all cursor-pointer flex items-center gap-1 ${
                  viewingTrash 
                    ? 'bg-primary-strong text-primary-strong-foreground shadow-sm' 
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                } ${isElderly ? 'px-5 py-2.5 text-sm' : 'px-3 py-1.5 text-xs'}`}
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>{t.vault.trashFolder}</span>
              </button>
            </div>

            {/* Simple Case-Insensitive Search Input */}
            <div className="relative max-w-md w-full">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground/60">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.vault.searchPlaceholder}
                className={`w-full bg-muted border border-border/80 rounded-[var(--r-control)] pl-9 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground font-semibold placeholder:text-muted-foreground/90 ${
                  isElderly ? 'text-sm' : 'text-xs'
                }`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="w-4 h-4 shrink-0" />
                </button>
              )}
            </div>
          </div>

          {/* Records Error Alert */}
          {recordsError && (
            <div className="flex items-start gap-2.5 bg-danger/10 text-danger border border-danger/25 p-4 rounded-[var(--r-card)] text-sm font-semibold">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{recordsError}</span>
            </div>
          )}

          {/* Chronological Timeline Container */}
          {isLoadingRecords && records.length === 0 ? (
            <div className="space-y-4 py-12">
              <div className="h-[100px] w-full bg-muted/20 animate-pulse rounded-3xl flex items-center justify-center text-xs text-muted-foreground font-semibold">
                Loading records...
              </div>
            </div>
          ) : records.length === 0 ? (
            // Trashed or Active Empty State
            <div className={`card-lift text-center flex flex-col items-center justify-center max-w-xl mx-auto space-y-4 py-16 ${
              isElderly ? 'p-16 border-4 border-dashed' : 'p-12 border-dashed'
            }`}>
              <div className={`rounded-full bg-muted flex items-center justify-center text-muted-foreground/60 ${
                isElderly ? 'w-16 h-16' : 'w-12 h-12'
              }`}>
                {viewingTrash ? <Trash2 className="w-8 h-8" /> : <FileText className="w-8 h-8" />}
              </div>
              <div className="space-y-2">
                <h3 className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-base'}`}>
                  {viewingTrash 
                    ? 'Trash is empty.' 
                    : searchQuery.trim() 
                      ? 'No search results found.' 
                      : 'No records uploaded yet.'}
                </h3>
                <p className={`text-muted-foreground max-w-sm mx-auto leading-relaxed ${isElderly ? 'text-lg' : 'text-xs'}`}>
                  {viewingTrash 
                    ? 'Deleted medical files will be stored here for 30 days before permanent purging.' 
                    : searchQuery.trim() 
                      ? 'Try updating your search query keywords.' 
                      : 'Upload your first medical record.'}
                </p>
              </div>
              {userRole !== 'CAREGIVER' && !viewingTrash && !searchQuery.trim() && (
                <button
                  onClick={() => openUploadModal(selectedCategory.id)}
                  disabled={isFull}
                  className={`font-black rounded bg-primary-strong text-primary-strong-foreground transition-all shadow-sm flex items-center justify-center ${
                    isElderly ? 'px-5 py-3 text-base' : 'px-4 py-2 text-xs'
                  } ${isFull ? 'opacity-40 cursor-not-allowed' : 'hover:bg-primary-strong-hover cursor-pointer'}`}
                >
                  <Upload className="w-4 h-4 mr-1.5 shrink-0" />
                  <span>{t.vault.uploadDocument}</span>
                </button>
              )}
            </div>
          ) : (
            // Chronological Grouped Timeline UI
            <div className="relative pl-6 md:pl-8 ml-6 md:ml-12 border-l border-border/80 space-y-12 py-4">
              {groupedTimeline.map((yearGroup) => (
                <div key={yearGroup.year} className="relative">
                  {/* Year Node */}
                  <div className={`absolute top-0.5 bg-primary-strong text-primary-strong-foreground font-black rounded-full border border-card shadow-sm flex items-center justify-center shrink-0 ${
                    isElderly 
                      ? 'w-20 h-9 -left-[46px] text-sm' 
                      : 'w-16 h-7 -left-[38px] text-[10px]'
                  }`}>
                    {yearGroup.year}
                  </div>

                  <div className={`space-y-8 ${isElderly ? 'pt-12' : 'pt-10'}`}>
                    {yearGroup.dates.map((dateGroup) => (
                      <div key={dateGroup.dateLabel} className="relative flex flex-col md:flex-row md:items-start gap-4">
                        {/* Timeline Date Label (15 Mar) */}
                        <div className="md:w-20 shrink-0 text-left md:pt-1">
                          <span className={`font-extrabold text-foreground block ${isElderly ? 'text-lg' : 'text-xs'}`}>
                            {dateGroup.dateLabel}
                          </span>
                        </div>

                        {/* Node bullet */}
                        <div className={`absolute rounded-full bg-border border border-card shrink-0 ${
                          isElderly 
                            ? 'w-4 h-4 -left-[30px] top-2 border-2' 
                            : 'w-3 h-3 -left-[22px] top-1.5 border-2'
                        }`} />

                        {/* Cards in this Date Group */}
                        <div className="flex-1 space-y-3">
                          {dateGroup.items.map((item) => (
                            <div
                              key={item.id}
                              className={`card-lift flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all duration-300 ${
                                isElderly 
                                  ? 'p-6 border-2 hover:scale-[1.005] hover:shadow-md' 
                                  : 'p-4 hover:scale-[1.005] hover:shadow-md'
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`p-2.5 bg-muted rounded-xl text-primary shrink-0 flex items-center justify-center`}>
                                  <FileText className="w-5 h-5 shrink-0" />
                                </div>
                                <div className="min-w-0">
                                  <h4 className={`font-black text-foreground truncate ${isElderly ? 'text-lg' : 'text-sm'}`}>
                                    {item.title}
                                  </h4>
                                  <p className={`text-muted-foreground truncate font-semibold mt-0.5 ${isElderly ? 'text-sm' : 'text-[10px]'}`}>
                                    {item.file_name} • {(item.file_size / (1024 * 1024)).toFixed(2)} MB
                                  </p>
                                </div>
                              </div>

                              {/* Document Action Items */}
                              <div className="flex flex-wrap items-center gap-2.5 shrink-0 self-end lg:self-auto">
                                <span className={`uppercase font-extrabold px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground font-mono ${
                                  isElderly ? 'text-[10px]' : 'text-[8px]'
                                }`}>
                                  {item.file_name.split('.').pop() || 'file'}
                                </span>

                                {!viewingTrash ? (
                                  <>
                                    <button
                                      onClick={() => handlePreview(item.file_url, item.file_type, item.title, item.file_name)}
                                      className={`font-black rounded bg-muted text-foreground hover:bg-muted/80 border border-border flex items-center justify-center cursor-pointer transition-all ${
                                        isElderly ? 'px-4 py-2 text-xs' : 'px-2.5 py-1 text-[10px]'
                                      }`}
                                    >
                                      <Eye className="w-3.5 h-3.5 mr-1 shrink-0" />
                                      <span>{t.vault.preview}</span>
                                    </button>

                                    <button
                                      onClick={() => handleDownload(item.file_url, item.file_name)}
                                      className={`font-black rounded bg-muted text-foreground hover:bg-muted/80 border border-border flex items-center justify-center cursor-pointer transition-all ${
                                        isElderly ? 'px-4 py-2 text-xs' : 'px-2.5 py-1 text-[10px]'
                                      }`}
                                    >
                                      <Download className="w-3.5 h-3.5 mr-1 shrink-0" />
                                      <span>{t.vault.download}</span>
                                    </button>

                                    {userRole !== 'CAREGIVER' && (
                                      <>
                                        <button
                                          onClick={() => openEditModal(item)}
                                          className={`font-black rounded bg-muted text-foreground hover:bg-muted/80 border border-border flex items-center justify-center cursor-pointer transition-all ${
                                            isElderly ? 'px-4 py-2 text-xs' : 'px-2.5 py-1 text-[10px]'
                                          }`}
                                        >
                                          <Edit className="w-3.5 h-3.5 mr-1 shrink-0" />
                                          <span>{t.vault.edit}</span>
                                        </button>

                                        <button
                                          onClick={() => handleSoftDelete(item.id)}
                                          className={`font-black rounded bg-danger/10 text-danger hover:bg-danger/15 border border-danger/25 flex items-center justify-center cursor-pointer transition-all ${
                                            isElderly ? 'px-4 py-2 text-xs' : 'px-2.5 py-1 text-[10px]'
                                          }`}
                                        >
                                          <Trash2 className="w-3.5 h-3.5 mr-1 shrink-0" />
                                          <span>{t.vault.delete}</span>
                                        </button>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  userRole !== 'CAREGIVER' && (
                                    <>
                                      <button
                                        onClick={() => handleRestore(item.id)}
                                        className={`font-black rounded bg-success/10 text-success hover:bg-success/15 border border-success/25 flex items-center justify-center cursor-pointer transition-all ${
                                          isElderly ? 'px-4.5 py-2 text-xs' : 'px-3 py-1 text-[10px]'
                                        }`}
                                      >
                                        <RotateCcw className="w-3.5 h-3.5 mr-1 shrink-0" />
                                        <span>{t.vault.restore}</span>
                                      </button>

                                      <button
                                        onClick={() => setRecordToPermanentlyDelete(item)}
                                        className={`font-black rounded bg-danger/10 text-danger hover:bg-danger/15 border border-danger/25 flex items-center justify-center cursor-pointer transition-all ${
                                          isElderly ? 'px-4.5 py-2 text-xs' : 'px-3 py-1 text-[10px]'
                                        }`}
                                      >
                                        <Trash className="w-3.5 h-3.5 mr-1 shrink-0" />
                                        <span>{t.vault.purgeForever}</span>
                                      </button>
                                    </>
                                  )
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Load More Pagination Trigger */}
              {totalRecordsCount > records.length && (
                <div className="flex justify-center pt-8">
                  <button
                    onClick={handleLoadMore}
                    disabled={isLoadingRecords}
                    className={`font-black rounded bg-muted text-foreground hover:bg-muted/80 transition-all border border-border flex items-center justify-center gap-2 cursor-pointer ${
                      isElderly ? 'px-6 py-3.5 text-base shadow-sm' : 'px-5 py-2.5 text-xs'
                    }`}
                  >
                    {isLoadingRecords ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        <span>{t.vault.loadingMore}</span>
                      </>
                    ) : (
                      <span>{t.vault.loadMore}</span>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edit Metadata Modal */}
      {recordToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm animate-fade-in">
          <div className={`bg-card w-full max-w-md relative ${isElderly ? 'border-2 border-border shadow-2xl rounded-3xl p-8' : 'card-overlay rounded-[var(--r-card)] p-6'}`}>
            <div className="flex items-center justify-between border-b border-border/50 pb-4 mb-4">
              <div>
                <h3 className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-lg'}`}>{t.vault.editTitle}</h3>
                <p className={`text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>{t.vault.editSubtitle}</p>
              </div>
              <button onClick={() => setRecordToEdit(null)} className="text-muted-foreground hover:text-foreground hover:bg-muted p-1.5 rounded-full cursor-pointer">
                <X className="w-5 h-5 shrink-0" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className={`block font-black text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>{t.vault.fieldTitle}</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className={`w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                    isElderly ? 'text-lg font-bold' : 'text-sm font-semibold'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className={`block font-black text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>{t.vault.fieldDate}</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className={`w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                    isElderly ? 'text-lg font-bold' : 'text-sm font-semibold'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className={`block font-black text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>{t.vault.fieldCategory}</label>
                <select
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  className={`w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                    isElderly ? 'text-lg font-bold' : 'text-sm font-semibold'
                  }`}
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border/50 pt-4 mt-6">
              <button
                onClick={() => setRecordToEdit(null)}
                disabled={isSavingEdit}
                className="px-4 py-2 rounded-xl text-xs font-black border border-border text-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className="px-4 py-2 rounded-xl text-xs font-black bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover flex items-center gap-1 cursor-pointer"
              >
                {isSavingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>{t.vault.saveChanges}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Confirmation Modal */}
      {recordToPermanentlyDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/70 backdrop-blur-sm animate-fade-in">
          <div className={`bg-card w-full max-w-md relative text-center space-y-4 ${
            isElderly
              ? 'border-2 border-border shadow-2xl rounded-3xl p-8'
              : 'card-overlay rounded-[var(--r-card)] p-6'
          }`}>
            <div className="p-3 bg-danger/10 text-danger rounded-full w-14 h-14 flex items-center justify-center mx-auto shrink-0">
              <Trash className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-lg'}`}>
                {t.vault.confirmDeleteTitle}
              </h3>
              <p className={`text-muted-foreground leading-relaxed ${isElderly ? 'text-base' : 'text-xs'}`}>
                {t.vault.irreversible}
              </p>
              <p className={`font-extrabold text-foreground ${isElderly ? 'text-sm mt-2' : 'text-[11px] mt-2'}`}>
                {format(t.vault.typeToConfirm, { token: t.vault.confirmToken })}
              </p>
            </div>

            <input
              type="text"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              placeholder={format(t.vault.confirmPlaceholder, { token: t.vault.confirmToken })}
              className={`w-full bg-muted border border-danger/30 rounded-xl px-4 py-2.5 text-center text-foreground focus:outline-none focus:ring-2 focus:ring-danger/20 font-black uppercase tracking-widest ${
                isElderly ? 'text-sm' : 'text-xs'
              }`}
            />

            <div className="flex items-center gap-3 border-t border-border/50 pt-4 mt-6">
              <button
                onClick={() => {
                  setRecordToPermanentlyDelete(null);
                  setDeleteConfirmationText('');
                }}
                disabled={isDeletingPermanently}
                className="flex-1 px-4 py-2.5 rounded-xl text-xs font-black border border-border text-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handlePermanentDelete}
                disabled={isDeletingPermanently || deleteConfirmationText.trim().toUpperCase() !== 'DELETE'}
                className="flex-1 px-4 py-2.5 rounded-xl text-xs font-black bg-danger-solid text-danger-solid-foreground hover:bg-danger/95 flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeletingPermanently ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>{t.vault.deleteForever}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Wizard Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm animate-fade-in">
          <div 
            className={`bg-card w-full max-w-lg relative flex flex-col ${
              isElderly
                ? 'border-2 border-border shadow-2xl rounded-3xl p-8'
                : 'card-overlay rounded-[var(--r-card)] p-6'
            }`}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border/50 pb-4 mb-4">
              <div>
                <h3 className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-lg'}`}>
                  Upload Health Record
                </h3>
                <p className={`text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
                  Follow the steps to store your document.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                disabled={isUploading}
                className="w-11 h-11 shrink-0 inline-flex items-center justify-center text-foreground bg-muted hover:bg-muted/70 rounded-full transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="w-5 h-5 shrink-0" />
              </button>
            </div>

            {/* Step Indicators */}
            <div className="flex items-center justify-between px-2 mb-6 text-[10px] font-black text-muted-foreground uppercase tracking-wider">
              <span className={activeStep === 1 ? "text-primary border-b-2 border-primary pb-0.5" : ""}>{t.vault.step1}</span>
              <span className={activeStep === 2 ? "text-primary border-b-2 border-primary pb-0.5" : ""}>{t.vault.step2}</span>
              <span className={activeStep === 3 ? "text-primary border-b-2 border-primary pb-0.5" : ""}>{t.vault.step3}</span>
              <span className={activeStep === 4 ? "text-primary border-b-2 border-primary pb-0.5" : ""}>{t.vault.step4}</span>
            </div>

            {/* Error Message Panel */}
            {uploadError && (
              <div className="flex items-start gap-2.5 bg-danger/10 text-danger border border-danger/25 p-3.5 rounded-[var(--r-control)] mb-4 text-xs font-semibold animate-shake">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Step Contents */}
            <div className="flex-1 min-h-[160px] flex flex-col justify-center">
              {activeStep === 1 && (
                <div className="space-y-4">
                  <label className={`block font-black text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>
                    Select Category Folder
                  </label>
                  <select
                    value={selectedCategoryId}
                    onChange={(e) => setSelectedCategoryId(e.target.value)}
                    className={`w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                      isElderly ? 'text-lg font-bold' : 'text-sm font-semibold'
                    }`}
                  >
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  <p className={`text-muted-foreground ${isElderly ? 'text-base' : 'text-[11px]'}`}>
                    Your file will be organized inside this folder category.
                  </p>
                </div>
              )}

              {activeStep === 2 && (
                <div className="space-y-4">
                  <label className={`block font-black text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>
                    Add the document
                  </label>

                  {/* TWO LABELLED DOORS, not one picker with a camera hidden inside it.
                      Most of what belongs in this vault is a piece of paper the user is
                      holding — a prescription, a lab report — so photographing it is the
                      primary path, not an alternative to browsing files. It leads, and
                      it says what it does.

                      There were no doors at all before: the single input carried neither
                      `capture` nor `image/*`, and Capacitor's onShowFileChooser needs BOTH
                      to route to the camera, so the app offered a documents-only chooser
                      and the vault's actual front door did not exist. */}
                  <div className={`grid gap-3 ${showCamera ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {showCamera && (
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={isPreparingFile}
                        className={`flex flex-col items-center justify-center gap-2 rounded-[var(--r-control)] bg-primary-strong text-primary-strong-foreground font-black transition-all hover:bg-primary-strong-hover active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          isElderly ? 'min-h-[112px] px-4 text-lg' : 'min-h-[88px] px-3 text-sm'
                        }`}
                      >
                        <Camera className={isElderly ? 'w-8 h-8' : 'w-6 h-6'} aria-hidden />
                        <span>{t.vault.takePhoto}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isPreparingFile}
                      className={`flex flex-col items-center justify-center gap-2 rounded-[var(--r-control)] border-2 border-border bg-card text-foreground font-black transition-all hover:border-primary/50 hover:bg-muted/50 active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                        isElderly ? 'min-h-[112px] px-4 text-lg' : 'min-h-[88px] px-3 text-sm'
                      }`}
                    >
                      <FolderOpen className={isElderly ? 'w-8 h-8' : 'w-6 h-6'} aria-hidden />
                      <span>{t.vault.chooseFile}</span>
                    </button>
                  </div>

                  {/* Capacitor routes to the camera only when `capture` is present AND
                      acceptTypes contains the literal `image/*` — list membership, so
                      `image/jpeg` silently falls back to the file picker. Do not narrow
                      this accept value. No CAMERA permission is involved: the manifest
                      deliberately does not declare it, which is what makes
                      isMediaCaptureSupported() true and launches the capture intent with
                      no prompt. Declaring it would REQUIRE a runtime grant. */}
                  <input
                    type="file"
                    ref={cameraInputRef}
                    onChange={(e) => handleFileChange(e, true)}
                    accept={VAULT_CAMERA_ACCEPT}
                    capture="environment"
                    className="hidden"
                  />
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept={VAULT_ACCEPT_ATTR}
                    className="hidden"
                  />

                  {isPreparingFile && (
                    <div className="flex items-center gap-2.5 rounded-[var(--r-control)] bg-muted px-4 py-3">
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin text-primary" aria-hidden />
                      <div className="min-w-0">
                        <p className={`font-black text-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
                          Getting the photo ready…
                        </p>
                        <p className="text-[11px] text-muted-foreground font-semibold">
                          Making it smaller so it uploads quickly
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Drag and drop is a desktop affordance, so it only appears where a
                      mouse does — on a phone it was a large dead panel above the thing
                      you actually tap. */}
                  {!showCamera && !isPreparingFile && (
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`border-2 border-dashed rounded-[var(--r-card)] p-5 flex flex-col items-center justify-center gap-2 transition-all duration-200 ${
                        isDragging
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-muted/30'
                      }`}
                    >
                      <UploadCloud className="w-8 h-8 text-muted-foreground/60 shrink-0" aria-hidden />
                      <p className="text-[11px] text-muted-foreground font-semibold">
                        or drag a file here
                      </p>
                    </div>
                  )}

                  {/* Says what is accepted BEFORE the picker opens. The rules are
                      enforced by the server either way; this is so nobody hunts
                      through a gallery for a file that was never going to fit. */}
                  <p className={`text-muted-foreground font-semibold ${isElderly ? 'text-sm' : 'text-[11px]'}`}>
                    {VAULT_ALLOWED_LABEL}, up to {(VAULT_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB each.
                    Photos are made smaller automatically.
                  </p>

                  {/* Only when it actually happened, and phrased as reassurance —
                      a file whose size changed between picking and uploading is
                      alarming if nobody mentions it. */}
                  {compressedFrom !== null && selectedFile && (
                    <p className={`font-semibold text-success-strong ${isElderly ? 'text-sm' : 'text-[11px]'}`}>
                      Photo made smaller — {(compressedFrom / (1024 * 1024)).toFixed(1)} MB
                      to {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB. It stays readable.
                    </p>
                  )}
                  {/* CHECK IT BEFORE IT COSTS A SLOT. The photo is shown at a size
                      you can actually judge, with the retake sitting right next to
                      it — the vault holds five files and a blurred one is a wasted
                      fifth. Nothing has been uploaded at this point, so a retake
                      costs nothing but the tap. */}
                  {selectedFile && filePreviewUrl && (
                    <div className="space-y-2.5">
                      <div className="overflow-hidden rounded-[var(--r-card)] border border-border bg-muted/40">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={filePreviewUrl}
                          alt={t.vault.photoAlt}
                          className={`w-full object-contain ${isElderly ? 'max-h-72' : 'max-h-56'}`}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => (fromCamera ? cameraInputRef : fileInputRef).current?.click()}
                          className={`flex-1 inline-flex items-center justify-center gap-2 rounded-[var(--r-control)] border-2 border-border bg-card font-black text-foreground transition-colors hover:bg-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            isElderly ? 'min-h-14 text-base' : 'min-h-12 text-sm'
                          }`}
                        >
                          {fromCamera
                            ? <><Camera className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} aria-hidden /> {t.vault.retake}</>
                            : <><FolderOpen className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} aria-hidden /> {t.vault.chooseAnother}</>}
                        </button>
                      </div>
                      <p className={`text-muted-foreground font-semibold ${isElderly ? 'text-sm' : 'text-[11px]'}`}>
                        {t.vault.canYouReadIt}
                      </p>
                    </div>
                  )}

                  {selectedFile && (
                    <div className="bg-muted p-3.5 rounded-[var(--r-control)] flex items-center justify-between text-xs font-semibold text-foreground">
                      <div className="truncate pr-4">
                        <span>{selectedFile.name}</span>
                        <span className="text-[10px] text-muted-foreground block font-mono">
                          {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile(null);
                          // Or the "photo made smaller" line outlives the photo.
                          setCompressedFrom(null);
                          setFromCamera(false);
                          setFilePreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
                          setUploadError(null);
                        }}
                        className="text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <X className="w-4 h-4 shrink-0" />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {format(t.vault.formats, { formats: VAULT_ALLOWED_LABEL })} <br/>
                    {format(t.vault.maxSize, { size: `${Math.round(VAULT_MAX_BYTES / 1024 / 1024)} MB` })}
                  </p>
                </div>
              )}

              {activeStep === 3 && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className={`block font-black text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>
                      Record Title
                    </label>
                    <input
                      type="text"
                      value={recordTitle}
                      onChange={(e) => setRecordTitle(e.target.value)}
                      placeholder={t.vault.titlePlaceholder}
                      className={`w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                        isElderly ? 'text-lg font-bold' : 'text-sm font-semibold'
                      }`}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className={`block font-black text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>
                      Record Date
                    </label>
                    <input
                      type="date"
                      value={recordDate}
                      onChange={(e) => setRecordDate(e.target.value)}
                      className={`w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                        isElderly ? 'text-lg font-bold' : 'text-sm font-semibold'
                      }`}
                    />
                  </div>
                </div>
              )}

              {activeStep === 4 && (
                <div className="space-y-4 text-center">
                  {uploadSuccess ? (
                    <div className="flex flex-col items-center justify-center py-6 space-y-3">
                      {/* Static. It was `animate-bounce` — infinite, so it never
                          stopped celebrating a file upload. CLAUDE.md earns motion
                          in exactly two places and this is neither; the tick and
                          the words already say it worked. */}
                      <CheckCircle className="w-16 h-16 text-success shrink-0" />
                      <div>
                        <h4 className={`font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>
                          {/* Sentence case, no exclamation (ux-copy). */}
                          Record saved
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Refreshing timeline view...
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-muted p-5 rounded-[var(--r-card)] text-left space-y-3 text-xs font-semibold text-foreground">
                      <h4 className="font-black border-b border-border/40 pb-2 text-foreground">{t.vault.summaryTitle}</h4>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t.vault.labelCategory}</span>
                        <span className="text-foreground font-black">
                          {categories.find(c => c.id === selectedCategoryId)?.name || 'Unknown'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t.vault.labelTitle}</span>
                        <span className="text-foreground font-black truncate max-w-[60%]">{recordTitle}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t.vault.labelDate}</span>
                        <span className="text-foreground font-black">{recordDate}</span>
                      </div>
                      <div className="flex justify-between border-t border-border/40 pt-2">
                        <span className="text-muted-foreground">{t.vault.labelFileName}</span>
                        <span className="text-foreground font-black truncate max-w-[60%]">
                          {selectedFile?.name}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t.vault.labelFileSize}</span>
                        <span className="text-foreground font-black font-mono">
                          {selectedFile ? (selectedFile.size / (1024 * 1024)).toFixed(2) : '0'} MB
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer (Controls) */}
            {!uploadSuccess && (
              <div className="flex items-center justify-between border-t border-border/50 pt-4 mt-6">
                <div>
                  {activeStep > 1 && (
                    <button
                      onClick={() => setActiveStep((prev) => (prev - 1) as any)}
                      disabled={isUploading}
                      className={`font-black rounded border border-border text-foreground hover:bg-muted transition-all cursor-pointer flex items-center justify-center ${
                        isElderly ? 'px-5 py-3 text-base' : 'px-3.5 py-2 text-xs'
                      }`}
                    >
                      <ArrowLeft className="w-3.5 h-3.5 mr-1 shrink-0" />
                      <span>{t.vault.back}</span>
                    </button>
                  )}
                </div>

                <div>
                  {activeStep < 4 ? (
                    <button
                      onClick={() => {
                        if (activeStep === 2 && !selectedFile) {
                          setUploadError(t.vault.errChooseFileFirst);
                          return;
                        }
                        if (activeStep === 3 && !recordTitle.trim()) {
                          setUploadError(t.vault.errTitleForRecord);
                          return;
                        }
                        setUploadError(null);
                        setActiveStep((prev) => (prev + 1) as any);
                      }}
                      className={`font-black rounded bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all cursor-pointer flex items-center justify-center ${
                        isElderly ? 'px-5 py-3 text-base' : 'px-3.5 py-2 text-xs'
                      }`}
                    >
                      <span>{t.vault.next}</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-1 shrink-0" />
                    </button>
                  ) : (
                    <button
                      onClick={handleUploadSave}
                      disabled={isUploading}
                      className={`font-black rounded bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2.5 text-xs'
                      }`}
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                          <span>{t.vault.saving}</span>
                        </>
                      ) : (
                        <span>{t.vault.uploadAndSave}</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewUrl && (
        <div
          onClick={closePreview}
          role="presentation"
          className={`fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-background/70 backdrop-blur-md ${
            previewClosing ? 'animate-backdrop-out' : 'animate-fade-in'
          }`}
        >
          {/* h-[88dvh] + tighter mobile padding: at 375px the old p-4/p-6 pair left a
              document window barely half the screen. dvh, not vh, so the browser chrome
              collapsing on scroll doesn't push the footer under the toolbar. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className={`bg-card w-full max-w-4xl h-[88dvh] sm:h-[80vh] flex flex-col relative ${
              previewClosing ? 'animate-modal-out' : 'animate-modal-in'
            } ${isElderly
              ? 'border-2 border-border shadow-2xl rounded-2xl sm:rounded-3xl p-4 sm:p-8'
              : 'card-overlay rounded-[var(--r-card)] p-3 sm:p-6'}`}
          >
            {/* Preview Header */}
            <div className="flex items-center justify-between border-b border-border/50 pb-4 mb-4">
              <div>
                <h3 className={`font-black text-foreground truncate max-w-[280px] md:max-w-md ${isElderly ? 'text-2xl' : 'text-lg'}`}>
                  {previewTitle}
                </h3>
                <p className={`text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
                  Secure Document Preview
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Universal cross-device action: opens the file in a new tab so the device's
                    native viewer renders it (the only reliable way to view PDFs on mobile). */}
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`font-black rounded bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    isElderly ? 'px-5 py-2.5 text-sm' : 'px-3 py-1.5 text-xs'
                  }`}
                >
                  <Eye className="w-4 h-4 shrink-0" />
                  <span>{t.vault.open}</span>
                </a>
                <button
                  onClick={closePreview}
                  aria-label={t.vault.closePreview}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted p-1.5 rounded-full transition-all cursor-pointer"
                >
                  <X className="w-5 h-5 shrink-0" />
                </button>
              </div>
            </div>

            {/* Preview Display Zone */}
            <div className="flex-1 bg-muted/20 rounded-[var(--r-card)] overflow-hidden flex items-center justify-center relative min-h-[320px]">
              {(() => {
                const kind = previewKindOf(previewName || previewTitle || '', previewType);

                if (kind === 'image') {
                  // Pinch / double-tap / buttons. A photographed prescription is
                  // usually handwriting on a paper slip, so "can I read it at all"
                  // is the whole reason it was filed — a fixed-size preview made
                  // the document unreadable and the file pointless.
                  return <ZoomableImage src={previewUrl} alt={previewTitle || 'Preview'} />;
                }

                if (kind === 'pdf') {
                  // <object> renders the PDF inline on desktop. Mobile browsers can't embed a
                  // PDF, so they show the fallback (an "Open / Download" action that hands off
                  // to the device's native PDF viewer). The header "Open" button works too.
                  return (
                    <object
                      data={previewUrl || undefined}
                      type="application/pdf"
                      className="w-full h-full rounded-[var(--r-control)] bg-white"
                    >
                      <div className="w-full h-full flex flex-col items-center justify-center text-center gap-4 p-8">
                        <FileText className="w-12 h-12 text-primary mx-auto shrink-0" />
                        <div>
                          <h4 className="font-black text-foreground">{t.vault.tapToViewPdf}</h4>
                          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                            Inline preview isn't supported in this browser. Open it in your device's
                            viewer instead.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2.5">
                          <a
                            href={previewUrl || undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`font-black rounded bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all cursor-pointer shadow-sm flex items-center justify-center ${
                              isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                            }`}
                          >
                            <Eye className="w-4 h-4 mr-1.5 shrink-0" />
                            <span>{t.vault.openPdf}</span>
                          </a>
                          <button
                            onClick={() => previewName && previewUrl && handleDownloadUrl(previewUrl, previewName)}
                            className={`font-black rounded bg-muted text-foreground hover:bg-muted/80 border border-border transition-all cursor-pointer flex items-center justify-center ${
                              isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                            }`}
                          >
                            <Download className="w-4 h-4 mr-1.5 shrink-0" />
                            <span>{t.vault.download}</span>
                          </button>
                        </div>
                      </div>
                    </object>
                  );
                }

                if (kind === 'text') {
                  return (
                    <iframe
                      src={previewUrl || undefined}
                      title={previewTitle || 'Document Preview'}
                      className="w-full h-full border-none rounded-[var(--r-control)] bg-white"
                    />
                  );
                }

                // Office docs, zip, etc. — cannot be rendered in-browser; offer open/download.
                return (
                  <div className="text-center space-y-4 p-8">
                    <AlertCircle className="w-12 h-12 text-warning mx-auto shrink-0" />
                    <div>
                      <h4 className="font-black text-foreground">{t.vault.previewUnavailable}</h4>
                      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                        {getExt(previewName || '') ? `.${getExt(previewName || '')} files` : 'This file type'} can't
                        be shown here. Open it in your device's app or download it.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2.5">
                      <a
                        href={previewUrl || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`font-black rounded bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover transition-all cursor-pointer shadow-sm flex items-center justify-center ${
                          isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                        }`}
                      >
                        <Eye className="w-4 h-4 mr-1.5 shrink-0" />
                        <span>{t.vault.open}</span>
                      </a>
                      <button
                        onClick={() => previewName && previewUrl && handleDownloadUrl(previewUrl, previewName)}
                        className={`font-black rounded bg-muted text-foreground hover:bg-muted/80 border border-border transition-all cursor-pointer flex items-center justify-center ${
                          isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                        }`}
                      >
                        <Download className="w-4 h-4 mr-1.5 shrink-0" />
                        <span>{t.vault.download}</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
