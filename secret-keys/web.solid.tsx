/** @jsxImportSource @solidjs/web */
/**
 * ⌘K New secret… names a key, with its value now or later, and opens the Secrets panel at it. ⌘K Forget a secret…
 * removes a key added here or by an agent. The value goes straight to Ultimate's `secrets/set`, as the panel's does.
 */
import { KeyRound, LoaderCircle } from '@lucide/solid'
import type { JSX } from '@solidjs/web'
import { createEffect, createSignal, For, Show } from 'solid-js'
import type { Component } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog.solid.tsx'
import { Input, SecretInput } from '@/components/ui/input.solid.tsx'
import {
  ROOT,
  actionRef,
  api,
  cn,
  defineWebExtension,
  errorMessage,
  events,
  keepLast,
  openPanel,
  useAction,
  useDialog,
  useEvent,
  useSystem,
  writingAs,
} from '@/sdk/solid'
import { ListAction, SetAction } from '@/../../extensions/secrets/refs.ts'
import { deadline } from '@/../../lib/timers.ts'
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

function Field(props: { label: string; hint?: string; error?: string; children: JSX.Element }) {
  return (
    <label class="flex flex-col gap-1">
      <span class="flex items-baseline gap-2 text-[12px] font-medium text-foreground/90">
        {props.label}
        <Show when={props.hint}>
          <span class="font-normal text-muted-foreground/75">{props.hint}</span>
        </Show>
      </span>
      {props.children}
      <Show when={props.error}>
        <span class="text-[11.5px] leading-snug text-warning">{props.error}</span>
      </Show>
    </label>
  )
}

/** This extension's declared keys as this page last heard them; it changes when a reload installed new ones. */
function useDeclared() {
  const system = useSystem()
  return () =>
    JSON.stringify(
      system()?.extensions.find((extension) => extension.name === 'secret-keys')?.server?.secrets,
    )
}

/**
 * The Secrets panel's own list read (same action, arguments and conversation), re-read when the declarations change.
 * The panel opens a requested row only if its list already has it, so `secrets:open` waits until this read does.
 */
const useStored = () =>
  useAction(ListAction, null, { conversation: ROOT, onError: keepLast, on: useDeclared() })

type Saved = { name: string; value: boolean; source: string }

function NewSecret(props: { close: () => void }) {
  const stored = useStored()
  const [name, setName] = createSignal('')
  const [value, setValue] = createSignal('')
  const [description, setDescription] = createSignal('')
  const [url, setUrl] = createSignal('')
  const [touched, setTouched] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [failure, setFailure] = createSignal<string>()
  const [saved, setSaved] = createSignal<Saved>()
  const problem = () => nameProblem(name())
  const linkProblem = () => urlProblem(url().trim())
  const existing = () => stored.data()?.find((secret) => secret.name === name())
  const listed = () => {
    const done = saved()
    return !!done && !!stored.data()?.some((secret) => secret.name === done.name)
  }

  // Set once saved: the panel opens when the reloaded declaration reached its list, so its row is there to open.
  createEffect(
    () => ({ done: saved(), inList: listed(), close: props.close }),
    ({ done, inList, close }) => {
      if (!done) return undefined
      // A saved value opens the panel, not the row: `secrets:open` opens its form, which would ask for the value again.
      const open = (row: boolean) =>
        writingAs(done.source, () => {
          if (row && !done.value) events.emit('secrets:open', { name: done.name })
          else openPanel('secrets')
          close()
        })
      if (inList) {
        open(true)
        return undefined
      }
      // A slower reload still lists it once done. No row is requested meanwhile: the panel drops a request its list lacks.
      return deadline(5000, () => open(false))
    },
  )

  async function save(source: string) {
    setTouched(true)
    if (problem() || linkProblem() || busy()) return
    const key = name()
    const secret = value().trim()
    setBusy(true)
    setFailure(undefined)
    try {
      await api.action(Declare, { name: key, description: description(), url: url().trim() })
      if (secret) {
        await writingAs(source, () => api.action(SetAction, { name: key, value: secret }))
        setValue('')
        writingAs(source, () => events.emit('secrets:changed', { name: key }))
      }
      setSaved({ name: key, value: !!secret, source })
    } catch (error) {
      setFailure(errorMessage(error))
      setBusy(false)
    }
  }

  let saveButton: HTMLButtonElement | undefined
  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    saveButton?.click()
  }

  return (
    <>
      <div class="space-y-4 px-6 pt-6 pb-5">
        <div class="space-y-2">
          <DialogTitle class="flex items-center gap-2 text-base">
            <KeyRound aria-hidden="true" class="size-4 text-brand" />
            New secret
          </DialogTitle>
          <DialogDescription class="text-[13px] leading-relaxed text-muted-foreground">
            Name it now. Paste the value here, or leave it empty: it waits in Secrets as missing
            until you add it.
          </DialogDescription>
        </div>
        <Field
          error={touched() || name() ? problem() : undefined}
          hint={
            existing()
              ? existing()?.set
                ? 'already set: a value replaces it'
                : 'already listed'
              : undefined
          }
          label="Name"
        >
          <Input
            aria-label="Name"
            data-secret-name
            disabled={busy()}
            onKeyDown={submitOnEnter}
            onValueChange={(next) => setName(next.toUpperCase().replace(/[\s-]/g, '_'))}
            placeholder="MY_API_KEY"
            value={name()}
          />
        </Field>
        <Field hint="optional" label="Value">
          {/* No <form>, as in the Secrets panel: browsers must not offer to save a key. */}
          <SecretInput
            aria-label="Value"
            data-secret-value
            disabled={busy()}
            onKeyDown={submitOnEnter}
            onValueChange={setValue}
            placeholder="Paste it now, or later in Secrets"
            value={value()}
          />
        </Field>
        <Field hint="optional, shown in Secrets" label="What it's for">
          <Input
            aria-label="What it's for"
            class="font-sans"
            disabled={busy()}
            onKeyDown={submitOnEnter}
            onValueChange={setDescription}
            placeholder="OpenRouter key for the openrouter models"
            spellcheck
            value={description()}
          />
        </Field>
        <Field error={linkProblem()} hint="optional" label="Where to get it">
          <Input
            aria-label="Where to get it"
            class="font-sans"
            disabled={busy()}
            onKeyDown={submitOnEnter}
            onValueChange={setUrl}
            placeholder="https://example.com/keys"
            value={url()}
          />
        </Field>
      </div>
      <footer class="space-y-3 border-t border-border/60 bg-muted/30 px-6 py-4">
        <Show when={failure()}>
          <p class="text-[12px] text-error">{failure()}</p>
        </Show>
        <div class="flex items-center justify-end gap-2">
          <Button onClick={() => props.close()} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button
            data-agent-confirm={
              value().trim() && (stored.data() === undefined || existing()?.set)
                ? 'Replaces the stored secret'
                : undefined
            }
            data-secret-save
            disabled={busy() || (touched() && (!!problem() || !!linkProblem()))}
            onClick={(_, details) => save(details.source)}
            ref={(element) => {
              saveButton = element
            }}
            size="sm"
          >
            <Show when={busy()}>
              <LoaderCircle aria-hidden="true" class="motion-safe:animate-spin" />
            </Show>
            {value().trim() ? 'Save secret' : 'Add empty key'}
          </Button>
        </div>
      </footer>
    </>
  )
}

function ForgetKeys(props: { close: () => void }) {
  const declared = useDeclared()
  // A key forgotten here or in another window, or added by an agent, changes the list.
  const keys = useAction(ListKeys, null, { conversation: ROOT, on: declared })
  const stored = useStored()
  const [busy, setBusy] = createSignal<string>()
  const [failure, setFailure] = createSignal<string>()
  useEvent('secrets:changed', () => void stored.refetch())

  async function forget(name: string) {
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
      <div class="space-y-4 px-6 pt-6 pb-5">
        <div class="space-y-2">
          <DialogTitle class="flex items-center gap-2 text-base">
            <KeyRound aria-hidden="true" class="size-4 text-brand" />
            Forget a secret
          </DialogTitle>
          <DialogDescription class="text-[13px] leading-relaxed text-muted-foreground">
            Keys added with New secret… or by an agent. Forgetting one takes it off the Secrets
            list; a value you stored stays until you delete it there.
          </DialogDescription>
        </div>
        <Show when={keys.error()}>
          {(error) => <p class="text-[12px] text-error">{errorMessage(error())}</p>}
        </Show>
        <Show when={keys.data()}>
          {(list) => (
            <Show
              fallback={<p class="text-[12.5px] text-muted-foreground">No keys to forget.</p>}
              when={list().length}
            >
              <ul class="divide-y divide-border/70 border-y border-border/70">
                <For each={list()} keyed={(key) => key.name}>
                  {(key) => {
                    const set = () =>
                      stored.data()?.find((secret) => secret.name === key().name)?.set
                    return (
                      <li aria-label={key().name} class="flex items-center gap-3 py-2.5">
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2">
                            <span class="truncate font-mono text-[12.5px] text-foreground">
                              {key().name}
                            </span>
                            <span
                              class={cn(
                                'flex shrink-0 items-center gap-1.5 font-mono text-[11px]',
                                set() ? 'text-muted-foreground' : 'text-warning',
                              )}
                            >
                              <span
                                class={cn(
                                  'size-1.5 rounded-full',
                                  set() ? 'bg-success' : 'bg-warning',
                                )}
                              />
                              {set() ? 'set' : 'missing'}
                            </span>
                          </div>
                          <p class="truncate text-[12px] text-muted-foreground">
                            {key().description}
                          </p>
                        </div>
                        <Button
                          aria-label={`Forget ${key().name}`}
                          class="h-7 px-2 font-mono text-[11.5px] text-muted-foreground hover:text-error"
                          disabled={!!busy()}
                          onClick={() => forget(key().name)}
                          size="sm"
                          variant="ghost"
                        >
                          <Show when={busy() === key().name}>
                            <LoaderCircle aria-hidden="true" class="size-3.5 animate-spin" />
                          </Show>
                          Forget
                        </Button>
                      </li>
                    )
                  }}
                </For>
              </ul>
            </Show>
          )}
        </Show>
        <Show when={failure()}>
          <p class="text-[12px] text-error">{failure()}</p>
        </Show>
      </div>
      <footer class="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/30 px-6 py-4">
        <Button onClick={() => props.close()} size="sm" variant="ghost">
          Close
        </Button>
      </footer>
    </>
  )
}

const secretDialog = (id: string, Body: Component<{ close: () => void }>) =>
  function SecretDialog() {
    const [open, setOpen] = useDialog(id)
    return (
      <Dialog onOpenChange={setOpen} open={open()}>
        <DialogContent
          class="grid-cols-[minmax(0,1fr)] gap-0 p-0 sm:max-w-[28rem]"
          showCloseButton={false}
        >
          <Show when={open()}>
            <Body close={() => setOpen(false)} />
          </Show>
        </DialogContent>
      </Dialog>
    )
  }

export default defineWebExtension({
  slots: { overlay: [secretDialog(newDialog, NewSecret), secretDialog(forgetDialog, ForgetKeys)] },
  commands: [
    { id: newDialog, title: 'New secret…', run: (context) => context.open(newDialog) },
    { id: forgetDialog, title: 'Forget a secret…', run: (context) => context.open(forgetDialog) },
  ],
})
