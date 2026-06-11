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
  Eye
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
}

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.txt', '.zip'];
const LIMIT = 20;

export default function HealthVaultClientView({
  categories,
  userRole,
  patientName,
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

  // Upload Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Preview Modal State
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);

  // Form Field State
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [recordDate, setRecordDate] = useState<string>('');
  const [recordTitle, setRecordTitle] = useState<string>('');

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

    // Default record date to today
    const today = new Date().toISOString().split('T')[0];
    setRecordDate(today);
  }, [supabase]);

  // Load records when selectedCategory changes
  useEffect(() => {
    if (selectedCategory) {
      setRecords([]);
      setTotalRecordsCount(0);
      setCurrentPage(0);
      fetchRecords(selectedCategory.id, 0, false);
    } else {
      setRecords([]);
      setTotalRecordsCount(0);
    }
  }, [selectedCategory]);

  const fetchRecords = async (categoryId: string, page: number, append: boolean = false) => {
    setIsLoadingRecords(true);
    setRecordsError(null);
    try {
      const from = page * LIMIT;
      const to = from + LIMIT - 1;

      const { data, error, count } = await supabase
        .from('health_records')
        .select('id, title, record_date, file_name, file_url, file_type, file_size, uploaded_at', { count: 'exact' })
        .eq('category_id', categoryId)
        .order('record_date', { ascending: false })
        .range(from, to);

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
        .createSignedUrl(path, 60); // 60 seconds token expiry

      if (error) throw error;

      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = fileName;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to generate download link.');
    }
  };

  // Safe signed-url preview trigger
  const handlePreview = async (path: string, type: string, title: string) => {
    try {
      const { data, error } = await supabase.storage
        .from('health-vault')
        .createSignedUrl(path, 60); // 60 seconds token expiry

      if (error) throw error;

      setPreviewUrl(data.signedUrl);
      setPreviewType(type);
      setPreviewTitle(title);
    } catch (err) {
      console.error('Preview generation error:', err);
      alert('Failed to load document preview.');
    }
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

  // Upload validators
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
          file_type: selectedFile.type || `application/${fileExt}`,
          file_size: selectedFile.size,
        }]);

      if (dbError) {
        await supabase.storage.from('health-vault').remove([uniquePath]);
        throw new Error(`Database error: ${dbError.message}`);
      }

      setUploadSuccess(true);
      router.refresh();
      
      // Auto reload current category timeline if uploading inside details view
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
                {userRole === 'CAREGIVER' ? `${patientName}'s Health Vault` : 'My Health Vault'}
              </h1>
              <p className={`text-muted-foreground mt-1 ${isElderly ? 'text-lg' : 'text-sm'}`}>
                {userRole === 'CAREGIVER'
                  ? 'Access medical records and categories for your linked patient.'
                  : 'Securely upload, view, and organize your prescriptions, lab reports, and clinical summaries.'}
              </p>
            </div>
            {userRole !== 'CAREGIVER' && (
              <button
                onClick={() => openUploadModal()}
                className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer shadow-sm flex items-center justify-center ${
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
                  {selectedCategory.name}
                </h2>
                <p className={`text-muted-foreground ${isElderly ? 'text-lg mt-0.5' : 'text-xs'}`}>
                  Chronological history timeline • Loaded {records.length} of {totalRecordsCount} documents
                </p>
              </div>
            </div>
            {userRole !== 'CAREGIVER' && (
              <button
                onClick={() => openUploadModal(selectedCategory.id)}
                className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer shadow-sm flex items-center justify-center shrink-0 ${
                  isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                }`}
              >
                <Upload className="w-4 h-4 mr-1.5 shrink-0" />
                <span>Upload to {selectedCategory.name}</span>
              </button>
            )}
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
                Loading records timeline...
              </div>
            </div>
          ) : records.length === 0 ? (
            // Required Empty State for Timeline
            <div className={`bg-card border border-border rounded-3xl text-center shadow-sm flex flex-col items-center justify-center max-w-xl mx-auto space-y-4 py-16 ${
              isElderly ? 'p-16 border-4 border-dashed' : 'p-12 border-dashed'
            }`}>
              <div className={`rounded-full bg-muted flex items-center justify-center text-muted-foreground/60 ${
                isElderly ? 'w-16 h-16' : 'w-12 h-12'
              }`}>
                <FileText className={isElderly ? 'w-8 h-8' : 'w-6 h-6'} />
              </div>
              <div className="space-y-2">
                <h3 className={`font-black text-foreground ${isElderly ? 'text-2xl' : 'text-base'}`}>
                  No records uploaded yet.
                </h3>
                <p className={`text-muted-foreground max-w-sm mx-auto leading-relaxed ${isElderly ? 'text-lg' : 'text-xs'}`}>
                  Upload your first medical record.
                </p>
              </div>
              {userRole !== 'CAREGIVER' && (
                <button
                  onClick={() => openUploadModal(selectedCategory.id)}
                  className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer shadow-sm flex items-center justify-center ${
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
                              className={`bg-card rounded-2xl border border-border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 shadow-sm ${
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

                              <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
                                <span className={`uppercase font-extrabold px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground font-mono ${
                                  isElderly ? 'text-[10px]' : 'text-[8px]'
                                }`}>
                                  {item.file_name.split('.').pop() || 'file'}
                                </span>

                                <button
                                  onClick={() => handlePreview(item.file_url, item.file_type, item.title)}
                                  className={`font-black rounded bg-muted text-foreground hover:bg-muted/80 border border-border flex items-center justify-center cursor-pointer transition-all ${
                                    isElderly ? 'px-4.5 py-2.5 text-sm' : 'px-3 py-1.5 text-[10px]'
                                  }`}
                                >
                                  <Eye className="w-3.5 h-3.5 mr-1 shrink-0" />
                                  <span>Preview</span>
                                </button>

                                <button
                                  onClick={() => handleDownload(item.file_url, item.file_name)}
                                  className={`font-black rounded bg-primary/10 text-primary hover:bg-primary/15 border border-primary/25 flex items-center justify-center cursor-pointer transition-all ${
                                    isElderly ? 'px-4.5 py-2.5 text-sm' : 'px-3 py-1.5 text-[10px]'
                                  }`}
                                >
                                  <Download className="w-3.5 h-3.5 mr-1 shrink-0" />
                                  <span>Download</span>
                                </button>
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
                      <>
                        <span>Load More Records</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
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
                      className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer flex items-center justify-center ${
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
                      className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
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
              <button
                onClick={() => {
                  setPreviewUrl(null);
                  setPreviewType(null);
                  setPreviewTitle(null);
                }}
                className="text-muted-foreground hover:text-foreground hover:bg-muted p-1.5 rounded-full transition-all cursor-pointer"
              >
                <X className="w-5 h-5 shrink-0" />
              </button>
            </div>

            {/* Preview Display Zone */}
            <div className="flex-1 bg-muted/20 rounded-2xl overflow-hidden flex items-center justify-center relative min-h-[320px]">
              {previewType?.startsWith('image/') ? (
                <img 
                  src={previewUrl} 
                  alt={previewTitle || 'Preview'} 
                  className="max-w-full max-h-full object-contain p-2 rounded-2xl"
                />
              ) : previewType === 'application/pdf' || previewType === 'text/plain' || previewType?.startsWith('text/') ? (
                <iframe 
                  src={previewUrl} 
                  title={previewTitle || 'PDF Preview'} 
                  className="w-full h-full border-none rounded-2xl bg-white"
                />
              ) : (
                <div className="text-center space-y-4 p-8">
                  <AlertCircle className="w-12 h-12 text-warning mx-auto shrink-0" />
                  <div>
                    <h4 className="font-black text-foreground">Preview not available</h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                      This file format ({previewType?.split('/').pop() || 'unknown'}) cannot be previewed directly. Please download the file to view its contents.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (previewUrl && previewTitle) {
                        const a = document.createElement('a');
                        a.href = previewUrl;
                        a.download = previewTitle;
                        a.target = '_blank';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }
                    }}
                    className={`font-black rounded bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer shadow-sm flex items-center justify-center mx-auto ${
                      isElderly ? 'px-6 py-3.5 text-base' : 'px-4 py-2 text-xs'
                    }`}
                  >
                    <Download className="w-4 h-4 mr-1.5 shrink-0" />
                    <span>Download File</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
