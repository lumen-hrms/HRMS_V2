import * as React from 'react';
import { Plus, Save, X } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Platform Admin › Settings — today just who gets emailed when the landing
 *  page's contact form is submitted (`platform.platform_settings`,
 *  `GET`/`PATCH /api/platform-admin/settings`). More platform-wide config
 *  can land here later rather than one screen per setting. */
export function PlatformSettingsPage() {
  const { toast } = useToast();
  const [emails, setEmails] = React.useState<string[] | null>(null);
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    platformApi
      .getSettings()
      .then((s) => setEmails(s.contactNotifyEmails))
      .catch(() => setEmails([]));
  }, []);

  function addEmail() {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_RE.test(value)) {
      toast({ title: 'Not a valid email address', tone: 'error' });
      return;
    }
    if (emails?.includes(value)) {
      setDraft('');
      return;
    }
    setEmails([...(emails ?? []), value]);
    setDraft('');
  }

  function removeEmail(value: string) {
    setEmails((emails ?? []).filter((e) => e !== value));
  }

  async function save() {
    if (!emails) return;
    setSaving(true);
    try {
      const result = await platformApi.updateSettings(emails);
      setEmails(result.contactNotifyEmails);
      toast({ title: 'Settings saved' });
    } catch (err) {
      toast({
        title: isPlatformApiError(err) ? err.message : 'Could not save settings',
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Settings"
        description="Platform-wide configuration — not tied to any one tenant."
      />

      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h3 className="text-sm font-semibold">Contact form notifications</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Every submission from the landing page's contact form is emailed to these addresses,
            and always recorded on the Leads screen regardless of whether the email sends.
          </p>
        </div>

        {emails == null ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {emails.length === 0 && (
                <p className="text-sm text-muted-foreground">No recipients configured yet.</p>
              )}
              {emails.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-sm"
                >
                  {email}
                  <button
                    type="button"
                    onClick={() => removeEmail(email)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${email}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Input
                className="h-9 max-w-xs"
                placeholder="ops@lumenhrms.com"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addEmail();
                  }
                }}
              />
              <Button variant="outline" size="sm" onClick={addEmail} type="button">
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>

            <div>
              <Button size="sm" onClick={save} disabled={saving}>
                <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
