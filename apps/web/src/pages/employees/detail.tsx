import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { Upload, Download, ArrowRightLeft, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, getAccessToken, getTenantSubdomain, isApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/context/auth-context';

const DOCUMENT_CATEGORY_LABEL: Record<string, string> = {
  OFFER_LETTER: 'Offer letter',
  ID_PROOF: 'ID proof',
  ADDRESS_PROOF: 'Address proof',
  EDUCATION: 'Education',
  EXPERIENCE: 'Experience',
  OTHER: 'Other',
};
const DOCUMENT_CATEGORIES = Object.keys(DOCUMENT_CATEGORY_LABEL);

// Module 03 §4.4 — the allowed-transition graph, mirrored from
// EmployeesService's LIFECYCLE_TRANSITIONS. Keyed by current state; each
// target names the date field it requires (undefined = no date needed).
const LIFECYCLE_TRANSITIONS: Record<string, Record<string, string | undefined>> = {
  PRE_JOINING: { PROBATION: undefined },
  PROBATION: { CONFIRMED: 'confirmationDate', SEPARATED: 'lastWorkingDate', SUSPENDED: undefined },
  CONFIRMED: { NOTICE_PERIOD: 'noticeStartDate', SUSPENDED: undefined },
  NOTICE_PERIOD: { SEPARATED: 'lastWorkingDate', CONFIRMED: undefined },
  SUSPENDED: { PROBATION: undefined, CONFIRMED: undefined },
  SEPARATED: {},
};

const DATE_FIELD_LABEL: Record<string, string> = {
  confirmationDate: 'Confirmation date',
  noticeStartDate: 'Notice start date',
  lastWorkingDate: 'Last working date',
};

const STATE_LABEL: Record<string, string> = {
  PRE_JOINING: 'Pre-joining',
  PROBATION: 'Probation',
  CONFIRMED: 'Confirmed',
  NOTICE_PERIOD: 'Notice period',
  SUSPENDED: 'Suspended',
  SEPARATED: 'Separated',
};

const STATE_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'outline'> = {
  PRE_JOINING: 'outline',
  PROBATION: 'warning',
  CONFIRMED: 'success',
  NOTICE_PERIOD: 'warning',
  SUSPENDED: 'destructive',
  SEPARATED: 'outline',
};

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  FULL_TIME: 'Full time',
  PART_TIME: 'Part time',
  CONTRACT: 'Contract',
  INTERN: 'Intern',
  CONSULTANT: 'Consultant',
};

interface EmployeeDetail {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  lifecycleState: string;
  dateOfJoining: string | null;
  probationEndDate: string | null;
  confirmationDate: string | null;
  noticeStartDate: string | null;
  lastWorkingDate: string | null;
  userId: string | null;
  personalEmail: string | null;
  phone: string | null;
  gender: string | null;
  department: { name: string } | null;
  reportingManager: { firstName: string; lastName: string } | null;
  directReports: { id: string; firstName: string; lastName: string }[];
  maritalStatus: string | null;
  bloodGroup: string | null;
  nationality: string | null;
  photoUrl: string | null;
  employmentType: string | null;
  workLocation: string | null;
  ctcAnnual: string | null;
  payGrade: string | null;
  costCenter: string | null;
  panMasked: string | null;
  aadhaarLast4: string | null;
  uan: string | null;
  pfNumber: string | null;
  esicNumber: string | null;
  taxRegime: string | null;
  bankAccountHolderName: string | null;
  bankAccountMasked: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountType: string | null;
}

interface Doc {
  id: string;
  label: string;
  category: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName: string | null;
}

interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  altPhone: string | null;
  address: string | null;
  isPrimary: boolean;
}

const HR_ADMIN = ['COMPANY_ADMIN', 'HR_MANAGER'];

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [employee, setEmployee] = React.useState<EmployeeDetail | null>(null);
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [contacts, setContacts] = React.useState<EmergencyContact[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = React.useState(false);
  const [sensitiveDialogOpen, setSensitiveDialogOpen] = React.useState(false);
  const [contactDialog, setContactDialog] = React.useState<EmergencyContact | 'new' | null>(null);
  const [tab, setTab] = React.useState('profile');
  const { toast } = useToast();
  const canManage = !!user && HR_ADMIN.includes(user.role);

  const load = React.useCallback(() => {
    if (!id) return;
    api.get<EmployeeDetail>(`/employees/${id}`).then(setEmployee);
    api.get<Doc[]>(`/employees/${id}/documents`).then(setDocs);
    api.get<EmergencyContact[]>(`/employees/${id}/emergency-contacts`).then(setContacts);
  }, [id]);

  React.useEffect(load, [load]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const headers: Record<string, string> = {};
      const token = await getAccessToken();
      const subdomain = getTenantSubdomain();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (subdomain) headers['X-Tenant-Subdomain'] = subdomain;
      const res = await fetch(`/api/employees/${id}/documents?label=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (!res.ok) throw new Error((await res.json()).message ?? 'Upload failed');
      load();
    } catch (err) {
      setError(isApiError(err) ? err.message : (err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const headers: Record<string, string> = {};
      const token = await getAccessToken();
      const subdomain = getTenantSubdomain();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (subdomain) headers['X-Tenant-Subdomain'] = subdomain;
      const res = await fetch(`/api/employees/${id}/photo`, { method: 'POST', headers, body: formData });
      if (!res.ok) throw new Error((await res.json()).message ?? 'Photo upload failed');
      load();
    } catch (err) {
      setError(isApiError(err) ? err.message : (err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDownload(docId: string) {
    const { url } = await api.get<{ url: string }>(`/documents/${docId}/download-url`);
    window.open(url, '_blank');
  }

  async function handleDeleteDocument(docId: string) {
    await api.delete(`/documents/${docId}`);
    setDocs((ds) => ds.filter((d) => d.id !== docId));
    toast({ title: 'Document deleted' });
  }

  async function handleCategoryChange(docId: string, category: string) {
    await api.patch(`/documents/${docId}/category`, { category });
    setDocs((ds) => ds.map((d) => (d.id === docId ? { ...d, category } : d)));
  }

  if (!employee) return <p className="text-muted-foreground">Loading…</p>;

  const isSelf = user?.role === 'EMPLOYEE' && user.employeeId === employee.id;
  const initials = `${employee.firstName[0] ?? ''}${employee.lastName[0] ?? ''}`.toUpperCase();

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <label
            className={`group relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-secondary text-lg font-semibold text-secondary-foreground ${
              canManage || isSelf ? 'cursor-pointer' : ''
            }`}
            title={canManage || isSelf ? 'Change photo (JPEG/PNG/WebP, max 5MB)' : undefined}
          >
            {employee.photoUrl ? (
              <img src={employee.photoUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
            ) : (
              initials || '—'
            )}
            {(canManage || isSelf) && (
              <>
                <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-black/50 group-hover:flex">
                  <Upload className="h-4 w-4 text-white" />
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={handlePhotoUpload}
                />
              </>
            )}
          </label>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">
                {employee.firstName} {employee.lastName}
              </h1>
              <Badge variant={STATE_BADGE_VARIANT[employee.lifecycleState] ?? 'outline'}>
                {STATE_LABEL[employee.lifecycleState] ?? employee.lifecycleState}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {employee.employeeCode} · {employee.designation ?? 'No designation set'}
              {employee.department?.name ? ` · ${employee.department.name}` : ''}
            </p>
          </div>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setStatusDialogOpen(true)}>
            <ArrowRightLeft className="h-3.5 w-3.5" /> Change status
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="statutory">Compensation &amp; Statutory</TabsTrigger>
          <TabsTrigger value="bank">Bank</TabsTrigger>
          <TabsTrigger value="contacts">Emergency Contacts</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="reporting">Reporting</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Personal &amp; Contact</CardTitle>
              {(canManage || isSelf) && (
                <Button size="sm" variant="ghost" onClick={() => setProfileDialogOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Row label="Personal email" value={employee.personalEmail ?? '—'} />
              <Row label="Phone" value={employee.phone ?? '—'} />
              <Row label="Gender" value={employee.gender ?? '—'} />
              <Row label="Marital status" value={employee.maritalStatus ?? '—'} />
              <Row label="Blood group" value={employee.bloodGroup ?? '—'} />
              <Row label="Nationality" value={employee.nationality ?? '—'} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employment">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Employment</CardTitle>
              {canManage && (
                <Button size="sm" variant="ghost" onClick={() => setProfileDialogOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Row label="Department" value={employee.department?.name ?? '—'} />
              <Row
                label="Reporting manager"
                value={
                  employee.reportingManager
                    ? `${employee.reportingManager.firstName} ${employee.reportingManager.lastName}`
                    : '—'
                }
              />
              <Row label="Employment type" value={EMPLOYMENT_TYPE_LABEL[employee.employmentType ?? ''] ?? '—'} />
              <Row label="Work location" value={employee.workLocation ?? '—'} />
              <Row label="Annual CTC" value={employee.ctcAnnual ? `₹ ${Number(employee.ctcAnnual).toLocaleString('en-IN')}` : '—'} />
              <Row label="Pay grade" value={employee.payGrade ?? '—'} />
              <Row label="Cost center" value={employee.costCenter ?? '—'} />
            </CardContent>
          </Card>
          <LifecycleTimeline employee={employee} />
        </TabsContent>

        <TabsContent value="statutory">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Compensation &amp; Statutory</CardTitle>
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => setSensitiveDialogOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <MaskedRow
                employeeId={employee.id}
                label="PAN"
                masked={employee.panMasked}
                field="pan"
                canReveal={canManage}
              />
              <Row label="Aadhaar" value={employee.aadhaarLast4 ? `XXXX-XXXX-${employee.aadhaarLast4}` : '—'} />
              <Row label="UAN" value={employee.uan ?? '—'} />
              <Row label="PF number" value={employee.pfNumber ?? '—'} />
              <Row label="ESIC number" value={employee.esicNumber ?? '—'} />
              <Row label="Tax regime" value={employee.taxRegime ?? '—'} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bank">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Bank</CardTitle>
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => setSensitiveDialogOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Row label="Account holder" value={employee.bankAccountHolderName ?? '—'} />
              <MaskedRow
                employeeId={employee.id}
                label="Bank account"
                masked={employee.bankAccountMasked}
                field="bankAccountNumber"
                canReveal={canManage}
              />
              <Row label="Bank" value={employee.bankName ? `${employee.bankName} · ${employee.bankBranch ?? '—'}` : '—'} />
              <Row label="IFSC" value={employee.bankIfsc ?? '—'} />
              <Row label="Account type" value={employee.bankAccountType ?? '—'} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Emergency Contacts</CardTitle>
              {(canManage || isSelf) && (
                <Button size="sm" variant="outline" onClick={() => setContactDialog('new')}>
                  <Plus className="h-3.5 w-3.5" /> Add contact
                </Button>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {contacts.length === 0 && (
                <p className="text-sm text-muted-foreground">No emergency contacts on file.</p>
              )}
              {contacts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {c.name} {c.isPrimary && <Badge variant="success">Primary</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {c.relationship} · {c.phone}
                    </span>
                  </div>
                  {(canManage || isSelf) && (
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setContactDialog(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await api.delete(`/employees/${employee.id}/emergency-contacts/${c.id}`);
                          setContacts((cs) => cs.filter((x) => x.id !== c.id));
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Documents</CardTitle>
              <label>
                <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
                <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
                  <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Upload'}
                </span>
              </label>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {error && <p className="text-sm text-destructive">{error}</p>}
              {docs.length === 0 && <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>}
              {docs.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="flex flex-1 items-center gap-2 min-w-0">
                    <span className="truncate">{d.label}</span>
                    {canManage ? (
                      <Select
                        className="h-7 w-36 text-xs"
                        value={d.category}
                        onChange={(e) => handleCategoryChange(d.id, e.target.value)}
                      >
                        {DOCUMENT_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {DOCUMENT_CATEGORY_LABEL[c]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge variant="outline">{DOCUMENT_CATEGORY_LABEL[d.category] ?? d.category}</Badge>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => handleDownload(d.id)}>
                      <Download className="h-3.5 w-3.5" /> Download
                    </Button>
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteDocument(d.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reporting">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Reporting manager</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {employee.reportingManager ? (
                  <span className="font-medium">
                    {employee.reportingManager.firstName} {employee.reportingManager.lastName}
                  </span>
                ) : (
                  <span className="text-muted-foreground">No reporting manager set.</span>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Direct reports</CardTitle>
                <Link
                  to="/org-chart"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  View in org chart →
                </Link>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {employee.directReports.length === 0 && (
                  <p className="text-sm text-muted-foreground">No direct reports.</p>
                )}
                {employee.directReports.map((r) => (
                  <Link key={r.id} to={`/employees/${r.id}`}>
                    <Badge variant="outline">
                      {r.firstName} {r.lastName}
                    </Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <LifecycleDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        employee={employee}
        onChanged={(newState) => {
          load();
          toast({ title: 'Status updated', description: `Now ${STATE_LABEL[newState] ?? newState}` });
        }}
      />

      {profileDialogOpen && (
        <ProfileFieldsDialog
          employee={employee}
          selfEditOnly={isSelf}
          onOpenChange={setProfileDialogOpen}
          onSaved={() => {
            setProfileDialogOpen(false);
            load();
            toast({ title: 'Profile updated' });
          }}
        />
      )}

      {sensitiveDialogOpen && (
        <SensitiveFieldsDialog
          employee={employee}
          onOpenChange={setSensitiveDialogOpen}
          onSaved={() => {
            setSensitiveDialogOpen(false);
            load();
            toast({ title: 'Compensation & statutory details saved' });
          }}
        />
      )}

      {contactDialog && (
        <ContactDialog
          employeeId={employee.id}
          contact={contactDialog === 'new' ? null : contactDialog}
          onOpenChange={(open) => !open && setContactDialog(null)}
          onSaved={() => {
            setContactDialog(null);
            load();
            toast({ title: 'Emergency contact saved' });
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Only ever shows milestones that actually happened — driven by the real
 * date fields the lifecycle transitions write (§4.4), never a projected or
 * target date. An employee who hasn't been confirmed yet just has a shorter
 * timeline, not a greyed-out placeholder for a future date we don't know.
 */
function LifecycleTimeline({ employee }: { employee: EmployeeDetail }) {
  const milestones: { label: string; date: string }[] = [];
  if (employee.dateOfJoining) {
    milestones.push({ label: 'Joined (dateOfJoining)', date: employee.dateOfJoining });
  }
  if (employee.confirmationDate) {
    milestones.push({ label: 'Confirmed (confirmationDate)', date: employee.confirmationDate });
  }
  if (employee.noticeStartDate) {
    milestones.push({ label: 'Notice period started (noticeStartDate)', date: employee.noticeStartDate });
  }
  if (employee.lastWorkingDate) {
    milestones.push({ label: 'Separated (lastWorkingDate)', date: employee.lastWorkingDate });
  }

  if (milestones.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Lifecycle history</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {milestones.map((m, i) => (
            <div key={m.label} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${i === milestones.length - 1 ? 'bg-primary' : 'bg-success'}`}
                />
                {i < milestones.length - 1 && <span className="h-6 w-px bg-border" />}
              </div>
              <div className="-mt-0.5 flex flex-1 items-center justify-between text-sm">
                <span className="font-medium">{m.label}</span>
                <span className="text-muted-foreground">{fmtDate(m.date)}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MaskedRow({
  employeeId,
  label,
  masked,
  field,
  canReveal,
}: {
  employeeId: string;
  label: string;
  masked: string | null;
  field: 'pan' | 'bankAccountNumber';
  canReveal: boolean;
}) {
  const [revealed, setRevealed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');

  async function reveal() {
    if (reason.trim().length < 5) return;
    setBusy(true);
    try {
      const result = await api.post<{ field: string; value: string }>(`/employees/${employeeId}/reveal`, {
        field,
        reason: reason.trim(),
      });
      setRevealed(result.value);
      setConfirmOpen(false);
      setReason('');
    } catch {
      // silently ignore — the masked value stays shown
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-medium">
        {revealed ?? masked ?? '—'}
        {canReveal && masked && !revealed && (
          <button
            onClick={() => setConfirmOpen(true)}
            title="Reveal (logged)"
            className="text-muted-foreground hover:text-foreground"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        )}
      </span>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader title={`Reveal ${label}`} onClose={() => setConfirmOpen(false)} />
          <p className="mb-3 text-sm text-muted-foreground">
            This reveal is logged against your account. State why you need to see the unmasked
            value.
          </p>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Verifying bank details ahead of this month's payroll run."
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={reveal} disabled={busy || reason.trim().length < 5}>
              {busy ? '…' : 'Reveal'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileFieldsDialog({
  employee,
  selfEditOnly,
  onOpenChange,
  onSaved,
}: {
  employee: EmployeeDetail;
  selfEditOnly: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [personalEmail, setPersonalEmail] = React.useState(employee.personalEmail ?? '');
  const [phone, setPhone] = React.useState(employee.phone ?? '');
  const [gender, setGender] = React.useState(employee.gender ?? '');
  const [maritalStatus, setMaritalStatus] = React.useState(employee.maritalStatus ?? '');
  const [bloodGroup, setBloodGroup] = React.useState(employee.bloodGroup ?? '');
  const [nationality, setNationality] = React.useState(employee.nationality ?? '');
  const [employmentType, setEmploymentType] = React.useState(employee.employmentType ?? '');
  const [workLocation, setWorkLocation] = React.useState(employee.workLocation ?? '');
  const [ctcAnnual, setCtcAnnual] = React.useState(employee.ctcAnnual ?? '');
  const [payGrade, setPayGrade] = React.useState(employee.payGrade ?? '');
  const [costCenter, setCostCenter] = React.useState(employee.costCenter ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/employees/${employee.id}`, {
        personalEmail: personalEmail || undefined,
        phone: phone || undefined,
        gender: gender || undefined,
        maritalStatus: maritalStatus || undefined,
        bloodGroup: bloodGroup || undefined,
        nationality: nationality || undefined,
        // Employment-only fields — omitted entirely for a self-edit rather
        // than sent-and-silently-dropped, so the payload matches what the
        // UI actually let the employee change.
        ...(selfEditOnly
          ? {}
          : {
              employmentType: employmentType || undefined,
              workLocation: workLocation || undefined,
              ctcAnnual: ctcAnnual ? Number(ctcAnnual) : undefined,
              payGrade: payGrade || undefined,
              costCenter: costCenter || undefined,
            }),
      });
      onSaved();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={selfEditOnly ? 'Edit my contact details' : 'Edit personal & employment details'}
          onClose={() => onOpenChange(false)}
        />
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto pr-1">
          <Field label="Personal email">
            <Input type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Gender">
            <Select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">—</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
              <option value="UNDISCLOSED">Undisclosed</option>
            </Select>
          </Field>
          <Field label="Marital status">
            <Select value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value)}>
              <option value="">—</option>
              <option value="SINGLE">Single</option>
              <option value="MARRIED">Married</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Blood group">
            <Input value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)} placeholder="O+" />
          </Field>
          <Field label="Nationality">
            <Input value={nationality} onChange={(e) => setNationality(e.target.value)} />
          </Field>
          {!selfEditOnly && (
            <>
              <Field label="Employment type">
                <Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
                  <option value="">—</option>
                  {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Work location" className="col-span-2">
                <Input value={workLocation} onChange={(e) => setWorkLocation(e.target.value)} />
              </Field>
              <Field label="Annual CTC (₹)">
                <Input
                  type="number"
                  min={0}
                  value={ctcAnnual}
                  onChange={(e) => setCtcAnnual(e.target.value)}
                />
              </Field>
              <Field label="Pay grade">
                <Input value={payGrade} onChange={(e) => setPayGrade(e.target.value)} />
              </Field>
              <Field label="Cost center" className="col-span-2">
                <Input value={costCenter} onChange={(e) => setCostCenter(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SensitiveFieldsDialog({
  employee,
  onOpenChange,
  onSaved,
}: {
  employee: EmployeeDetail;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [pan, setPan] = React.useState('');
  const [aadhaarLast4, setAadhaarLast4] = React.useState(employee.aadhaarLast4 ?? '');
  const [uan, setUan] = React.useState(employee.uan ?? '');
  const [pfNumber, setPfNumber] = React.useState(employee.pfNumber ?? '');
  const [esicNumber, setEsicNumber] = React.useState(employee.esicNumber ?? '');
  const [taxRegime, setTaxRegime] = React.useState(employee.taxRegime ?? '');
  const [bankAccountHolderName, setBankAccountHolderName] = React.useState(
    employee.bankAccountHolderName ?? '',
  );
  const [bankAccountNumber, setBankAccountNumber] = React.useState('');
  const [bankIfsc, setBankIfsc] = React.useState(employee.bankIfsc ?? '');
  const [bankName, setBankName] = React.useState(employee.bankName ?? '');
  const [bankBranch, setBankBranch] = React.useState(employee.bankBranch ?? '');
  const [bankAccountType, setBankAccountType] = React.useState(employee.bankAccountType ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/employees/${employee.id}/sensitive-fields`, {
        pan: pan || undefined,
        aadhaarLast4: aadhaarLast4 || undefined,
        uan: uan || undefined,
        pfNumber: pfNumber || undefined,
        esicNumber: esicNumber || undefined,
        taxRegime: taxRegime || undefined,
        bankAccountHolderName: bankAccountHolderName || undefined,
        bankAccountNumber: bankAccountNumber || undefined,
        bankIfsc: bankIfsc || undefined,
        bankName: bankName || undefined,
        bankBranch: bankBranch || undefined,
        bankAccountType: bankAccountType || undefined,
      });
      onSaved();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not save — check the field formats.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title="Edit compensation, statutory & bank details"
          description="PAN and bank account are encrypted; only you and other HR/Admins can reveal them, and every reveal is logged."
          onClose={() => onOpenChange(false)}
        />
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto pr-1">
          <Field label="PAN" hint={employee.panMasked ? `Current: ${employee.panMasked}` : 'Not set'}>
            <Input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" />
          </Field>
          <Field label="Aadhaar (last 4)">
            <Input
              value={aadhaarLast4}
              maxLength={4}
              onChange={(e) => setAadhaarLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </Field>
          <Field label="UAN">
            <Input value={uan} onChange={(e) => setUan(e.target.value)} />
          </Field>
          <Field label="PF number">
            <Input value={pfNumber} onChange={(e) => setPfNumber(e.target.value)} />
          </Field>
          <Field label="ESIC number">
            <Input value={esicNumber} onChange={(e) => setEsicNumber(e.target.value)} />
          </Field>
          <Field label="Tax regime">
            <Select value={taxRegime} onChange={(e) => setTaxRegime(e.target.value)}>
              <option value="">—</option>
              <option value="OLD">Old</option>
              <option value="NEW">New</option>
            </Select>
          </Field>
          <Field label="Account holder name" className="col-span-2">
            <Input value={bankAccountHolderName} onChange={(e) => setBankAccountHolderName(e.target.value)} />
          </Field>
          <Field
            label="Bank account number"
            hint={employee.bankAccountMasked ? `Current: ${employee.bankAccountMasked}` : 'Not set'}
          >
            <Input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
          </Field>
          <Field label="IFSC">
            <Input value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Bank name">
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </Field>
          <Field label="Branch">
            <Input value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} />
          </Field>
          <Field label="Account type">
            <Select value={bankAccountType} onChange={(e) => setBankAccountType(e.target.value)}>
              <option value="">—</option>
              <option value="SAVINGS">Savings</option>
              <option value="CURRENT">Current</option>
            </Select>
          </Field>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({
  employeeId,
  contact,
  onOpenChange,
  onSaved,
}: {
  employeeId: string;
  contact: EmergencyContact | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(contact?.name ?? '');
  const [relationship, setRelationship] = React.useState(contact?.relationship ?? '');
  const [phone, setPhone] = React.useState(contact?.phone ?? '');
  const [altPhone, setAltPhone] = React.useState(contact?.altPhone ?? '');
  const [address, setAddress] = React.useState(contact?.address ?? '');
  const [isPrimary, setIsPrimary] = React.useState(contact?.isPrimary ?? false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (!name.trim() || !relationship.trim() || !phone.trim()) {
      setError('Name, relationship and phone are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        relationship: relationship.trim(),
        phone: phone.trim(),
        altPhone: altPhone || undefined,
        address: address || undefined,
        isPrimary,
      };
      if (contact) {
        await api.patch(`/employees/${employeeId}/emergency-contacts/${contact.id}`, payload);
      } else {
        await api.post(`/employees/${employeeId}/emergency-contacts`, payload);
      }
      onSaved();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not save contact');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={contact ? 'Edit emergency contact' : 'Add emergency contact'}
          onClose={() => onOpenChange(false)}
        />
        <div className="flex flex-col gap-4">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Relationship" required>
            <Input value={relationship} onChange={(e) => setRelationship(e.target.value)} />
          </Field>
          <Field label="Phone" required>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Alternate phone">
            <Input value={altPhone} onChange={(e) => setAltPhone(e.target.value)} />
          </Field>
          <Field label="Address">
            <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Primary contact
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LifecycleDialog({
  open,
  onOpenChange,
  employee,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeDetail;
  onChanged: (newState: string) => void;
}) {
  const edges = LIFECYCLE_TRANSITIONS[employee.lifecycleState] ?? {};
  const targets = Object.keys(edges);
  const [targetState, setTargetState] = React.useState(targets[0] ?? '');
  const [effectiveDate, setEffectiveDate] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setTargetState(targets[0] ?? '');
      setEffectiveDate('');
      setReason('');
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee.lifecycleState]);

  const requiredDateField = targetState ? edges[targetState] : undefined;

  async function submit() {
    if (!targetState) return;
    if (requiredDateField && !effectiveDate) {
      setFormError(`${DATE_FIELD_LABEL[requiredDateField]} is required for this transition.`);
      return;
    }
    if (!reason.trim()) {
      setFormError('A reason is required.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.patch(`/employees/${employee.id}/lifecycle`, {
        targetState,
        effectiveDate: effectiveDate || undefined,
        reason: reason.trim(),
      });
      onOpenChange(false);
      onChanged(targetState);
    } catch (err) {
      setFormError(isApiError(err) ? err.message : 'Could not change status — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Change lifecycle status"
          description={`${employee.firstName} ${employee.lastName} · ${employee.employeeCode}`}
          onClose={() => onOpenChange(false)}
        />
        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {STATE_LABEL[employee.lifecycleState] ?? employee.lifecycleState} is a terminal state — no further
            transitions.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Target state" required>
              <Select value={targetState} onChange={(e) => setTargetState(e.target.value)}>
                {targets.map((t) => (
                  <option key={t} value={t}>
                    {STATE_LABEL[t] ?? t}
                  </option>
                ))}
              </Select>
            </Field>
            {requiredDateField && (
              <Field label={DATE_FIELD_LABEL[requiredDateField]} required>
                <Input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
              </Field>
            )}
            {employee.userId && targetState === 'SEPARATED' && (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                This will disable the employee's login.
              </p>
            )}
            <Field label="Reason" required>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </Field>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? 'Saving…' : 'Confirm transition'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
