'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUiMode } from '@/context/ui-mode-context';
import { createClient } from '@/lib/supabase/client';
import { 
  FileText, 
  ClipboardList, 
  Binary, 
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
  Trash
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

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.txt', '.zip'];
const LIMIT = 20;

// Map a file extension to a correct MIME type. The browser's File.type is often empty on mobile
// or for some files; storing the right content-type lets the signed URL render inline (esp. PDFs).
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
  const router = useRouter();
  const supabase = createClient();

  const [mounted, setMounted] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Folder Timeline view state
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [totalRecordsCount, setTotalRecordsCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [recordsError, setRecordsError] = useState<string | null>(null);

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
  const [recordDate, setRecordDate] = useState<string>('');
  const [recordTitle, setRecordTitle] = useState<string>('');

  // Preview Modal State
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    async function getSession() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    }
    getSession();

    const today = new Date().toISOString().split('T')[0];
    setRecordDate(today);
  }, [supabase]);

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
      setRecordsError('Failed to load medical records timeline.');
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
      alert('Failed to generate download link.');
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
  const handlePreview = async (path: string, type: string, title: string, fileName: string) => {
    try {
      // Longer TTL so the "Open in new tab" link is still valid if tapped a bit later,
      // and force inline rendering so PDFs open in the browser's native viewer rather than
      // downloading. The MIME is derived from the file name extension for reliability.
      const { data, error } = await supabase.storage
        .from('health-vault')
        .createSignedUrl(path, 600, { download: false });

      if (error) throw error;

      setPreviewUrl(data.signedUrl);
      setPreviewType(mimeFor(fileName, type));
      setPreviewTitle(title);
      setPreviewName(fileName);
    } catch (err) {
      console.error('Preview generation error:', err);
      alert('Failed to load document preview.');
    }
  };

  // Soft Delete handler
  const handleSoftDelete = async (recordId: string) => {
    if (!confirm('Are you sure you want to move this record to the Trash?')) return;
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
      router.refresh();
    } catch (err) {
      console.error('Soft delete error:', err);
      alert('Failed to delete record.');
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
      router.refresh();
    } catch (err) {
      console.error('Restore error:', err);
      alert('Failed to restore record.');
    }
  };

  // Permanent Hard Delete handler
  const handlePermanentDelete = async () => {
    if (!recordToPermanentlyDelete) return;
    if (deleteConfirmationText.trim().toUpperCase() !== 'DELETE') {
      alert('Please type DELETE to confirm permanent destruction.');
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
      router.refresh();
    } catch (err: any) {
      console.error('Permanent delete error:', err);
      alert('Failed to permanently delete record.');
    } finally {
      setIsDeletingPermanently(false);
    }
  };

  // Metadata Edit Save handler
  const handleSaveEdit = async () => {
    if (!recordToEdit) return;
    if (!editTitle.trim()) {
      alert('Title is required.');
      return;
    }
    if (!editDate) {
      alert('Record date is required.');
      return;
    }
    if (!editCategoryId) {
      alert('Category folder selection is required.');
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
      alert('Failed to save record changes.');
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

  const getRecordCount = (category: Category) => {
    if (!category.health_records) return 0;
    if (Array.isArray(category.health_records)) {
      return category.health_records[0]?.count || 0;
    }
    return (category.health_records as any)?.count || 0;
  };

  const getCategoryIcon = (name: string, isElderlyMode: boolean) => {
    const iconClass = isElderlyMode ? "w-10 h-10 text-primary shrink-0" : "w-6 h-6 text-primary shrink-0";
    switch (name.toLowerCase()) {
      case 'prescriptions':
        return <FileText className={iconClass} />;
      case 'lab reports':
        return <ClipboardList className={iconClass} />;
      case 'scans':
        return <Binary className={iconClass} />;
      case 'discharge summaries':
        return <FileHeart className={iconClass} />;
      default:
        return <FolderHeart className={iconClass} />;
    }
  };

  // Upload handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const error = validateFile(file);
      if (error) {
        setUploadError(error);
        setSelectedFile(null);
      } else {
        setUploadError(null);
        setSelectedFile(file);
        const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        setRecordTitle(nameWithoutExt);
      }
    }
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
      const file = e.dataTransfer.files[0];
      const error = validateFile(file);
      if (error) {
        setUploadError(error);
        setSelectedFile(null);
      } else {
        setSelectedFile(file);
        const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        setRecordTitle(nameWithoutExt);
      }
    }
  };

  const validateFile = (file: File): string | null => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return `Unsupported file extension (${extension}). Supported: PDF, JPG, JPEG, PNG, WEBP, DOC, DOCX, TXT, ZIP.`;
    }
    const maxSize = 20 * 1024 * 1024; // 20 MB
    if (file.size > maxSize) {
      return 'File exceeds 20 MB size limit.';
    }
    return null;
  };

  const openUploadModal = (categoryId: string = '') => {
    setSelectedCategoryId(categoryId || (categories[0]?.id || ''));
    setSelectedFile(null);
    setUploadError(null);
    setUploadSuccess(false);
    setIsUploading(false);
    setActiveStep(1);
    
    const today = new Date().toISOString().split('T')[0];
    setRecordDate(today);
    setRecordTitle('');
    setIsModalOpen(true);
  };

  const handleUploadSave = async () => {
    if (!userId) {
      setUploadError('Session expired. Please log in.');
      return;
    }
    if (!selectedFile) {
      setUploadError('Please select a file.');
      return;
    }
    if (!selectedCategoryId || selectedCategoryId.startsWith('default-')) {
      setUploadError('Select a valid folder category.');
      return;
    }
    if (!recordTitle.trim()) {
      setUploadError('Record title is required.');
      return;
    }
    if (!recordDate) {
      setUploadError('Record date is required.');
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
        throw new Error(`Storage error: ${storageError.message}`);
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
        throw new Error(`Database error: ${dbError.message}`);
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
          {/* Title Header Section */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className={`font-extrabold text-foreground tracking-tight ${isElderly ? 'text-4xl' : 'text-2xl'}`}>
                {userRole === 'CAREGIVER' ? `Documents Shared by ${patientName}` : 'My Health Vault'}
              </h1>
              {userRole === 'CAREGIVER' && (
                <p className="text-xs text-primary font-bold mt-1.5 bg-primary/5 border border-primary/20 px-3 py-1.5 rounded-xl w-max">
                  Shared through Care Circle. You currently have read-only access.
                </p>
              )}
              <p className={`text-muted-foreground mt-2 ${isElderly ? 'text-lg' : 'text-sm'}`}>
                {userRole === 'CAREGIVER'
                  ? 'Access medical records and categories for your linked patient.'
                  : 'Securely upload, view, and organize your prescriptions, lab reports, and clinical summaries.'}
              </p>
            </div>
            {userRole !== 'CAREGIVER' && (
              <button
                onClick={() => openUploadModal()}
                className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary-hover transition-all cursor-pointer shadow-sm flex items-center justify-center ${
                  isElderly ? 'px-6 py-3.5 text-lg' : 'px-4 py-2 text-xs'
                }`}
              >
                <Upload className={`${isElderly ? 'w-5 h-5 mr-2' : 'w-4 h-4 mr-1'} shrink-0`} />
                <span>Upload Record</span>
              </button>
            )}
          </div>

          {/* Info Header Banner */}
          <div className={`flex items-start gap-3 bg-[#EAF3FF] text-primary border border-primary/20 rounded-3xl transition-all duration-300 ${
            isElderly ? 'p-6 border-2 text-lg' : 'p-4 text-xs'
          }`}>
            <ShieldCheck className={`text-primary shrink-0 ${isElderly ? 'w-8 h-8' : 'w-5 h-5'}`} />
            <div>
              <h4 className="font-extrabold mb-0.5">Secure Vault Storage Active</h4>
              <p className="opacity-90 font-medium">
                Your records are protected with Row-Level Security policies (RLS). File transfers are fully encrypted, and payloads are stored inside private object containers.
              </p>
            </div>
          </div>

          {/* Category Folders Grid */}
          <div className="space-y-4">
            <h3 className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-sm'}`}>
              Category Folder Vaults
            </h3>
            
            <div className={`grid grid-cols-1 gap-6 ${isElderly ? 'md:grid-cols-1' : 'md:grid-cols-2 lg:grid-cols-4'}`}>
              {displayCategories.map((category) => {
                const count = getRecordCount(category);
                return (
                  <div
                    key={category.id}
                    onClick={() => {
                      if (!category.id.startsWith('default-')) {
                        setSelectedCategory(category);
                        setViewingTrash(false);
                      }
                    }}
                    className={`bg-card rounded-3xl border border-border flex flex-col justify-between transition-all duration-300 shadow-sm cursor-pointer ${
                      isElderly 
                        ? 'p-8 border-4 border-primary/30 space-y-6' 
                        : 'p-5 hover:scale-[1.01] hover:shadow-md hover:border-primary/40 animate-breath space-y-4'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {getCategoryIcon(category.name, isElderly)}
                        <div>
                          <h4 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-2xl' : 'text-sm'}`}>
                            {category.name} ({count})
                          </h4>
                          <p className={`text-muted-foreground font-semibold ${isElderly ? 'text-base mt-1' : 'text-[11px]'}`}>
                            {count} {count === 1 ? 'document' : 'documents'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {userRole !== 'CAREGIVER' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openUploadModal(category.id);
                        }}
                        className={`font-black rounded bg-muted text-foreground hover:bg-muted/80 transition-all border border-border text-center w-full flex items-center justify-center cursor-pointer ${
                          isElderly ? 'py-3.5 text-base shadow-sm' : 'py-2 text-xs'
                        }`}
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                        <span>Upload Record</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
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
            <span>Back to Folder Vaults</span>
          </button>

          {/* Folder Details Header Panel */}
          <div className={`flex flex-col md:flex-row md:items-center md:justify-between bg-card rounded-3xl border border-border shadow-sm transition-all duration-300 gap-4 ${
            isElderly ? 'p-8 border-4 border-primary/30' : 'p-5'
          }`}>
            <div className="flex items-center gap-4">
              <div className={`p-3.5 bg-primary/10 rounded-2xl text-primary flex items-center justify-center`}>
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
              <button
                onClick={() => openUploadModal(selectedCategory.id)}
                className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary-hover transition-all cursor-pointer shadow-sm flex items-center justify-center shrink-0 ${
                  isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                }`}
              >
                <Upload className="w-4 h-4 mr-1.5 shrink-0" />
                <span>Upload to {selectedCategory.name}</span>
              </button>
            )}
          </div>

          {userRole === 'CAREGIVER' && (
            <div className="flex items-start gap-3.5 bg-primary/5 text-primary border border-primary/20 rounded-3xl p-5 text-xs">
              <ShieldCheck className="w-5 h-5 shrink-0 text-primary mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-extrabold text-sm text-foreground">📖 Documents Shared by {patientName}</h4>
                <p className="font-bold text-primary opacity-90">Shared through Care Circle. You currently have read-only access.</p>
                <p className="text-muted-foreground mt-1.5 leading-relaxed font-semibold">
                  {patientName} has chosen to share their health documents with you. You may review prescriptions, lab reports, and medical records. All documents remain read-only.
                </p>
              </div>
            </div>
          )}

          {/* Active / Trash Toggles & Simple Search Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border border-border/60 rounded-3xl p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewingTrash(false)}
                className={`font-black rounded-xl transition-all cursor-pointer ${
                  !viewingTrash 
                    ? 'bg-primary text-primary-foreground shadow-sm' 
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                } ${isElderly ? 'px-5 py-2.5 text-sm' : 'px-3 py-1.5 text-xs'}`}
              >
                Active Records
              </button>
              <button
                onClick={() => setViewingTrash(true)}
                className={`font-black rounded-xl transition-all cursor-pointer flex items-center gap-1 ${
                  viewingTrash 
                    ? 'bg-primary text-primary-foreground shadow-sm' 
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                } ${isElderly ? 'px-5 py-2.5 text-sm' : 'px-3 py-1.5 text-xs'}`}
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>Trash Folder</span>
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
                placeholder="Search by title or file name..."
                className={`w-full bg-muted border border-border/80 rounded-2xl pl-9 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground font-semibold placeholder:text-muted-foreground/50 ${
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
            <div className="flex items-start gap-2.5 bg-danger/10 text-danger border border-danger/25 p-4 rounded-3xl text-sm font-semibold">
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
            <div className={`bg-card border border-border rounded-3xl text-center shadow-sm flex flex-col items-center justify-center max-w-xl mx-auto space-y-4 py-16 ${
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
                  className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary-hover transition-all cursor-pointer shadow-sm flex items-center justify-center ${
                    isElderly ? 'px-5 py-3 text-base' : 'px-4 py-2 text-xs'
                  }`}
                >
                  <Upload className="w-4 h-4 mr-1.5 shrink-0" />
                  <span>Upload Document</span>
                </button>
              )}
            </div>
          ) : (
            // Chronological Grouped Timeline UI
            <div className="relative pl-6 md:pl-8 ml-6 md:ml-12 border-l border-border/80 space-y-12 py-4">
              {groupedTimeline.map((yearGroup) => (
                <div key={yearGroup.year} className="relative">
                  {/* Year Node */}
                  <div className={`absolute top-0.5 bg-primary text-primary-foreground font-black rounded-full border border-card shadow-sm flex items-center justify-center shrink-0 ${
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
                              className={`bg-card rounded-2xl border border-border flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all duration-300 shadow-sm ${
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
                                      <span>Preview</span>
                                    </button>

                                    <button
                                      onClick={() => handleDownload(item.file_url, item.file_name)}
                                      className={`font-black rounded bg-muted text-foreground hover:bg-muted/80 border border-border flex items-center justify-center cursor-pointer transition-all ${
                                        isElderly ? 'px-4 py-2 text-xs' : 'px-2.5 py-1 text-[10px]'
                                      }`}
                                    >
                                      <Download className="w-3.5 h-3.5 mr-1 shrink-0" />
                                      <span>Download</span>
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
                                          <span>Edit</span>
                                        </button>

                                        <button
                                          onClick={() => handleSoftDelete(item.id)}
                                          className={`font-black rounded bg-danger/10 text-danger hover:bg-danger/15 border border-danger/25 flex items-center justify-center cursor-pointer transition-all ${
                                            isElderly ? 'px-4 py-2 text-xs' : 'px-2.5 py-1 text-[10px]'
                                          }`}
                                        >
                                          <Trash2 className="w-3.5 h-3.5 mr-1 shrink-0" />
                                          <span>Delete</span>
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
                                        <span>Restore</span>
                                      </button>

                                      <button
                                        onClick={() => setRecordToPermanentlyDelete(item)}
                                        className={`font-black rounded bg-danger/10 text-danger hover:bg-danger/15 border border-danger/25 flex items-center justify-center cursor-pointer transition-all ${
                                          isElderly ? 'px-4.5 py-2 text-xs' : 'px-3 py-1 text-[10px]'
                                        }`}
                                      >
                                        <Trash className="w-3.5 h-3.5 mr-1 shrink-0" />
                                        <span>Purge Forever</span>
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
                        <span>Loading more...</span>
                      </>
                    ) : (
                      <span>Load More Records</span>
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
          <div className={`bg-card border border-border shadow-2xl rounded-3xl w-full max-w-md relative p-6 ${isElderly ? 'p-8 border-2' : 'p-6'}`}>
            <div className="flex items-center justify-between border-b border-border/50 pb-4 mb-4">
              <div>
                <h3 className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-lg'}`}>Edit Record Details</h3>
                <p className={`text-muted-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>Modify record categorizations and dates.</p>
              </div>
              <button onClick={() => setRecordToEdit(null)} className="text-muted-foreground hover:text-foreground hover:bg-muted p-1.5 rounded-full cursor-pointer">
                <X className="w-5 h-5 shrink-0" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className={`block font-black text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>Title</label>
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
                <label className={`block font-black text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>Record Date</label>
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
                <label className={`block font-black text-foreground ${isElderly ? 'text-lg' : 'text-xs'}`}>Category Folder</label>
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
                className="px-4 py-2 rounded-xl text-xs font-black bg-primary text-primary-foreground hover:bg-primary-hover flex items-center gap-1 cursor-pointer"
              >
                {isSavingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Confirmation Modal */}
      {recordToPermanentlyDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/70 backdrop-blur-sm animate-fade-in">
          <div className={`bg-card border border-border shadow-2xl rounded-3xl w-full max-w-md relative p-6 text-center space-y-4 ${
            isElderly ? 'p-8 border-2' : 'p-6'
          }`}>
            <div className="p-3 bg-danger/10 text-danger rounded-full w-14 h-14 flex items-center justify-center mx-auto shrink-0">
              <Trash className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-lg'}`}>
                Confirm Permanent Deletion
              </h3>
              <p className={`text-muted-foreground leading-relaxed ${isElderly ? 'text-base' : 'text-xs'}`}>
                This action is irreversible. The record metadata and physical storage file will be deleted forever.
              </p>
              <p className={`font-extrabold text-foreground ${isElderly ? 'text-sm mt-2' : 'text-[11px] mt-2'}`}>
                Please type <b className="text-danger">DELETE</b> below to confirm:
              </p>
            </div>

            <input
              type="text"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              placeholder="Type DELETE here..."
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
                className="flex-1 px-4 py-2.5 rounded-xl text-xs font-black bg-danger text-danger-foreground hover:bg-danger/95 flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeletingPermanently ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Delete Forever</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Wizard Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm animate-fade-in">
          <div 
            className={`bg-card border border-border shadow-2xl rounded-3xl w-full max-w-lg relative flex flex-col ${
              isElderly ? 'p-8 border-2' : 'p-6'
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
                className="text-muted-foreground hover:text-foreground hover:bg-muted p-1.5 rounded-full transition-all cursor-pointer"
              >
                <X className="w-5 h-5 shrink-0" />
              </button>
            </div>

            {/* Step Indicators */}
            <div className="flex items-center justify-between px-2 mb-6 text-[10px] font-black text-muted-foreground uppercase tracking-wider">
              <span className={activeStep === 1 ? "text-primary border-b-2 border-primary pb-0.5" : ""}>Step 1: Category</span>
              <span className={activeStep === 2 ? "text-primary border-b-2 border-primary pb-0.5" : ""}>Step 2: File</span>
              <span className={activeStep === 3 ? "text-primary border-b-2 border-primary pb-0.5" : ""}>Step 3: Details</span>
              <span className={activeStep === 4 ? "text-primary border-b-2 border-primary pb-0.5" : ""}>Step 4: Save</span>
            </div>

            {/* Error Message Panel */}
            {uploadError && (
              <div className="flex items-start gap-2.5 bg-danger/10 text-danger border border-danger/25 p-3.5 rounded-2xl mb-4 text-xs font-semibold animate-shake">
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
                    Choose File
                  </label>
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-3xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all duration-200 ${
                      isDragging 
                        ? 'border-primary bg-primary/5' 
                        : 'border-border hover:border-primary/50 bg-muted/40 hover:bg-muted/60'
                    }`}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept={ALLOWED_EXTENSIONS.join(',')}
                      className="hidden"
                    />
                    <UploadCloud className="w-10 h-10 text-muted-foreground/60 shrink-0" />
                    <div className="text-center space-y-1">
                      <p className={`font-black text-foreground ${isElderly ? 'text-base' : 'text-xs'}`}>
                        {selectedFile ? 'Selected File:' : 'Drag & Drop File Here'}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-semibold">
                        {selectedFile ? selectedFile.name : 'or click to browse local files'}
                      </p>
                    </div>
                  </div>
                  {selectedFile && (
                    <div className="bg-muted p-3.5 rounded-2xl flex items-center justify-between text-xs font-semibold text-foreground">
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
                        }}
                        className="text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <X className="w-4 h-4 shrink-0" />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Supported extensions: PDF, JPG, JPEG, PNG, WEBP, DOC, DOCX, TXT, ZIP. <br/>
                    Maximum file size limit: <b>20 MB</b>.
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
                      placeholder="e.g. Blood Test Report Q1"
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
                      <CheckCircle className="w-16 h-16 text-success shrink-0 animate-bounce" />
                      <div>
                        <h4 className={`font-black text-foreground ${isElderly ? 'text-xl' : 'text-sm'}`}>
                          Record Saved Successfully!
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Refreshing timeline view...
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-muted p-5 rounded-3xl text-left space-y-3 text-xs font-semibold text-foreground">
                      <h4 className="font-black border-b border-border/40 pb-2 text-foreground">Upload Details Summary</h4>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Category:</span>
                        <span className="text-foreground font-black">
                          {categories.find(c => c.id === selectedCategoryId)?.name || 'Unknown'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Title:</span>
                        <span className="text-foreground font-black truncate max-w-[60%]">{recordTitle}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Date:</span>
                        <span className="text-foreground font-black">{recordDate}</span>
                      </div>
                      <div className="flex justify-between border-t border-border/40 pt-2">
                        <span className="text-muted-foreground">File Name:</span>
                        <span className="text-foreground font-black truncate max-w-[60%]">
                          {selectedFile?.name}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">File Size:</span>
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
                      <span>Back</span>
                    </button>
                  )}
                </div>

                <div>
                  {activeStep < 4 ? (
                    <button
                      onClick={() => {
                        if (activeStep === 2 && !selectedFile) {
                          setUploadError('Please choose or drop a file before proceeding.');
                          return;
                        }
                        if (activeStep === 3 && !recordTitle.trim()) {
                          setUploadError('Please specify a title for this health record.');
                          return;
                        }
                        setUploadError(null);
                        setActiveStep((prev) => (prev + 1) as any);
                      }}
                      className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary-hover transition-all cursor-pointer flex items-center justify-center ${
                        isElderly ? 'px-5 py-3 text-base' : 'px-3.5 py-2 text-xs'
                      }`}
                    >
                      <span>Next</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-1 shrink-0" />
                    </button>
                  ) : (
                    <button
                      onClick={handleUploadSave}
                      disabled={isUploading}
                      className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary-hover transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2.5 text-xs'
                      }`}
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <span>Upload & Save</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/70 backdrop-blur-md animate-fade-in">
          <div 
            className={`bg-card border border-border shadow-2xl rounded-3xl w-full max-w-4xl h-[80vh] flex flex-col relative ${
              isElderly ? 'p-8 border-2' : 'p-6'
            }`}
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
                  className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary-hover transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    isElderly ? 'px-5 py-2.5 text-sm' : 'px-3 py-1.5 text-xs'
                  }`}
                >
                  <Eye className="w-4 h-4 shrink-0" />
                  <span>Open</span>
                </a>
                <button
                  onClick={() => {
                    setPreviewUrl(null);
                    setPreviewType(null);
                    setPreviewTitle(null);
                    setPreviewName(null);
                  }}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted p-1.5 rounded-full transition-all cursor-pointer"
                >
                  <X className="w-5 h-5 shrink-0" />
                </button>
              </div>
            </div>

            {/* Preview Display Zone */}
            <div className="flex-1 bg-muted/20 rounded-2xl overflow-hidden flex items-center justify-center relative min-h-[320px]">
              {(() => {
                const kind = previewKindOf(previewName || previewTitle || '', previewType);

                if (kind === 'image') {
                  return (
                    <img
                      src={previewUrl}
                      alt={previewTitle || 'Preview'}
                      className="max-w-full max-h-full object-contain p-2 rounded-2xl"
                    />
                  );
                }

                if (kind === 'pdf') {
                  // <object> renders the PDF inline on desktop. Mobile browsers can't embed a
                  // PDF, so they show the fallback (an "Open / Download" action that hands off
                  // to the device's native PDF viewer). The header "Open" button works too.
                  return (
                    <object
                      data={previewUrl || undefined}
                      type="application/pdf"
                      className="w-full h-full rounded-2xl bg-white"
                    >
                      <div className="w-full h-full flex flex-col items-center justify-center text-center gap-4 p-8">
                        <FileText className="w-12 h-12 text-primary mx-auto shrink-0" />
                        <div>
                          <h4 className="font-black text-foreground">Tap to view this PDF</h4>
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
                            className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary-hover transition-all cursor-pointer shadow-sm flex items-center justify-center ${
                              isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                            }`}
                          >
                            <Eye className="w-4 h-4 mr-1.5 shrink-0" />
                            <span>Open PDF</span>
                          </a>
                          <button
                            onClick={() => previewName && previewUrl && handleDownloadUrl(previewUrl, previewName)}
                            className={`font-black rounded bg-muted text-foreground hover:bg-muted/80 border border-border transition-all cursor-pointer flex items-center justify-center ${
                              isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                            }`}
                          >
                            <Download className="w-4 h-4 mr-1.5 shrink-0" />
                            <span>Download</span>
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
                      className="w-full h-full border-none rounded-2xl bg-white"
                    />
                  );
                }

                // Office docs, zip, etc. — cannot be rendered in-browser; offer open/download.
                return (
                  <div className="text-center space-y-4 p-8">
                    <AlertCircle className="w-12 h-12 text-warning mx-auto shrink-0" />
                    <div>
                      <h4 className="font-black text-foreground">Preview not available in-app</h4>
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
                        className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary-hover transition-all cursor-pointer shadow-sm flex items-center justify-center ${
                          isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                        }`}
                      >
                        <Eye className="w-4 h-4 mr-1.5 shrink-0" />
                        <span>Open</span>
                      </a>
                      <button
                        onClick={() => previewName && previewUrl && handleDownloadUrl(previewUrl, previewName)}
                        className={`font-black rounded bg-muted text-foreground hover:bg-muted/80 border border-border transition-all cursor-pointer flex items-center justify-center ${
                          isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                        }`}
                      >
                        <Download className="w-4 h-4 mr-1.5 shrink-0" />
                        <span>Download File</span>
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
