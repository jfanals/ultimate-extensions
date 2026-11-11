/**
 * ⌘K New secret… names a key, with its value now or later, and opens the Secrets panel at it. ⌘K Forget a secret…
 * removes a key added here or by an agent. The value goes straight to Ultimate's `secrets/set`, as the panel's does.
 */
import { EyeIcon, EyeOffIcon, KeyRoundIcon, LoaderCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  actionRef,
  api,
  cn,
  defineWebExtension,
  errorMessage,
  events,
  useAction,
  useDialog,
  useEvent,
  useSystem,
  useUltimate,
} from '@/sdk'
import { nameProblem, urlProblem } from './keys.ts'
import type { Key } from './keys.ts'

const newDialog = 'secret-keys.new'
const forgetDialog = 'secret-keys.forget'

const Declare = actionRef<{ name: string; description?: string; url?: string }, Key>(
  'secret-keys',
  'declare',
)
const Forget = actionRef<{ name: string }, { names: string[] }>('secret-keys', 'forget')
const ListKeys = actionRef<null, Key[]>('secret-keys', 'list')
// Ultimate's secrets extension, as its refs.ts names them; values go in and never come back.
const SetSecret = actionRef<{ name: string; value: string }, unknown>('secrets', 'set')
const ListSecrets = actionRef<null, { name: string; set: boolean; declaredBy: string[] }[]>(
  'secrets',
  'list',
)

const field =
  'h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60'

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-2 text-[12px] font-medium text-foreground/90">
        {label}
        {hint && <span className="font-normal text-muted-foreground/75">{hint}</span>}
      </span>
      {children}
      {error && <span className="text-[11.5px] leading-snug text-warning">{error}</span>}
    </label>
  )
}

/** This extension's declared keys as this page last heard them; it changes when a reload installed new ones. */
function useDeclared() {
  const system = useSystem()
  return JSON.stringify(
    system?.extensions.find((extension) => extension.name === 'secret-keys')?.server?.secrets,
  )
}

/**
 * The Secrets panel's own list read (same action, same arguments), re-read when the declarations change. The panel
 * opens a requested row only if its list already has it, so `secrets:open` waits until this read does.
 */
const useStored = () => useAction(ListSecrets, null, { onError: () => {}, on: [useDeclared()] })

function NewSecret({ onClose }: { onClose: () => void }) {
  const ui = useUltimate()
  const stored = useStored()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [shown, setShown] = useState(false)
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  // Set once saved: the panel opens when the reloaded declaration reached its list, so its row is there to open.
  const [saved, setSaved] = useState<{ name: string; value: boolean }>()
  const listed = !!saved && !!stored.data?.some((secret) => secret.name === saved.name)
  useEffect(() => {
    if (!saved) return
    // A saved value opens the panel, not the row: `secrets:open` opens its form, which would ask for the value again.
    const open = (row: boolean) => {
      if (row && !saved.value) events.emit('secrets:open', { name: saved.name })
      else ui.openPanel('secrets')
      onClose()
    }
    if (listed) return open(true)
    // A slower reload still lists it once done. No row is requested meanwhile: the panel drops a request its list lacks.
    const timer = setTimeout(() => open(false), 5000)
    return () => clearTimeout(timer)
  }, [saved, listed])
  const problem = nameProblem(name)
  const linkProblem = urlProblem(url.trim())
  const existing = stored.data?.find((secret) => secret.name === name)
  const save = async () => {
    setTouched(true)
    if (problem || linkProblem || busy) return
    setBusy(true)
    setFailure(undefined)
    try {
      await api.action(Declare, { name, description, url: url.trim() })
      if (value.trim()) {
        await api.action(SetSecret, { name, value: value.trim() })
        setValue('')
        events.emit('secrets:changed', { name })
      }
      setSaved({ name, value: !!value.trim() })
    } catch (error) {
      setFailure(errorMessage(error))
      setBusy(false)
    }
  }
  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    // oxlint-disable-next-line typescript/no-floating-promises -- save catches failures and shows them with setFailure.
    void save()
  }
  return (
    <>
      <div className="space-y-4 px-6 pt-6 pb-5">
        <div className="space-y-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRoundIcon className="size-4 text-brand" />
            New secret
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
            Name it now. Paste the value here, or leave it empty: it waits in Secrets as missing
            until you add it.
          </DialogDescription>
        </div>
        <Field
          error={touched || name ? problem : undefined}
          hint={
            existing
              ? existing.set
                ? 'already set: a value replaces it'
                : 'already listed'
              : undefined
          }
          label="Name"
        >
          <input
            aria-label="Name"
            autoFocus
            className={cn(field, 'font-mono')}
            data-secret-name
            disabled={busy}
            onChange={(event) => setName(event.target.value.toUpperCase().replace(/[\s-]/g, '_'))}
            onKeyDown={submitOnEnter}
            placeholder="MY_API_KEY"
            spellCheck={false}
            value={name}
          />
        </Field>
        <Field hint="optional" label="Value">
          {/* No <form> and a one-time-code field, as in the Secrets panel: browsers must not offer to save a key. */}
          <div className="flex items-center gap-1.5">
            <input
              aria-label="Value"
              autoComplete="one-time-code"
              className={cn(field, 'font-mono')}
              data-1p-ignore
              data-bwignore
              data-lpignore="true"
              data-secret-value
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={submitOnEnter}
              placeholder="Paste it now, or later in Secrets"
              spellCheck={false}
              type={shown ? 'text' : 'password'}
              value={value}
            />
            <Button
              aria-label={shown ? 'Hide value' : 'Show value'}
              aria-pressed={shown}
              className="size-8 text-muted-foreground"
              onClick={() => setShown(!shown)}
              size="icon-sm"
              title={shown ? 'Hide value' : 'Show value'}
              type="button"
              variant="ghost"
            >
              {shown ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
            </Button>
          </div>
        </Field>
        <Field hint="optional, shown in Secrets" label="What it's for">
          <input
            aria-label="What it's for"
            className={field}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={submitOnEnter}
            placeholder="OpenRouter key for the openrouter models"
            value={description}
          />
        </Field>
        <Field error={linkProblem} hint="optional" label="Where to get it">
          <input
            aria-label="Where to get it"
            className={field}
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={submitOnEnter}
            placeholder="https://example.com/keys"
            spellCheck={false}
            value={url}
          />
        </Field>
      </div>
      <footer className="space-y-3 border-t border-border/60 bg-muted/30 px-6 py-4">
        {failure && <p className="text-[12px] text-error">{failure}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button
            data-secret-save
            disabled={busy || (touched && (!!problem || !!linkProblem))}
            onClick={() => void save()}
            size="sm"
          >
            {busy && <LoaderCircleIcon className="motion-safe:animate-spin" />}
            {value.trim() ? 'Save secret' : 'Add empty key'}
          </Button>
        </div>
      </footer>
    </>
  )
}

function ForgetKeys({ onClose }: { onClose: () => void }) {
  // A key forgotten here or in another window, or added by an agent, changes the list.
  const keys = useAction(ListKeys, null, { on: [useDeclared()] })
  const stored = useStored()
  const [busy, setBusy] = useState<string>()
  const [failure, setFailure] = useState<string>()
  useEvent('secrets:changed', () => void stored.refetch())
  const forget = async (name: string) => {
    setBusy(name)
    setFailure(undefined)
    try {
      await api.action(Forget, { name })
      await keys.refetch()
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <>
      <div className="space-y-4 px-6 pt-6 pb-5">
        <div className="space-y-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRoundIcon className="size-4 text-brand" />
            Forget a secret
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
            Keys added with New secret… or by an agent. Forgetting one takes it off the Secrets
            list; a value you stored stays until you delete it there.
          </DialogDescription>
        </div>
        {keys.error && <p className="text-[12px] text-error">{errorMessage(keys.error)}</p>}
        {keys.data && keys.data.length === 0 && (
          <p className="text-[12.5px] text-muted-foreground">No keys to forget.</p>
        )}
        {keys.data && keys.data.length > 0 && (
          <ul className="divide-y divide-border/70 border-y border-border/70">
            {keys.data.map((key) => {
              const set = stored.data?.find((secret) => secret.name === key.name)?.set
              return (
                <li aria-label={key.name} className="flex items-center gap-3 py-2.5" key={key.name}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[12.5px] text-foreground">
                        {key.name}
                      </span>
                      <span
                        className={cn(
                          'flex shrink-0 items-center gap-1.5 font-mono text-[11px]',
                          set ? 'text-muted-foreground' : 'text-warning',
                        )}
                      >
                        <span
                          className={cn('size-1.5 rounded-full', set ? 'bg-success' : 'bg-warning')}
                        />
                        {set ? 'set' : 'missing'}
                      </span>
                    </div>
                    <p className="truncate text-[12px] text-muted-foreground">{key.description}</p>
                  </div>
                  <Button
                    className="h-7 px-2 font-mono text-[11.5px] text-muted-foreground hover:text-error"
                    disabled={!!busy}
                    onClick={() => void forget(key.name)}
                    size="sm"
                    variant="ghost"
                  >
                    {busy === key.name && <LoaderCircleIcon className="size-3.5 animate-spin" />}
                    Forget
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {failure && <p className="text-[12px] text-error">{failure}</p>}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/30 px-6 py-4">
        <Button onClick={onClose} size="sm" variant="ghost">
          Close
        </Button>
      </footer>
    </>
  )
}

function SecretDialog({ id, Body }: { id: string; Body: typeof NewSecret }) {
  const [open, setOpen] = useDialog(id)
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-0 p-0 sm:max-w-[28rem]">
        {open && <Body onClose={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}

export default defineWebExtension({
  slots: {
    overlay: [
      () => <SecretDialog Body={NewSecret} id={newDialog} />,
      () => <SecretDialog Body={ForgetKeys} id={forgetDialog} />,
    ],
  },
  commands: [
    { id: newDialog, title: 'New secret…', run: (context) => context.open(newDialog) },
    { id: forgetDialog, title: 'Forget a secret…', run: (context) => context.open(forgetDialog) },
  ],
})
