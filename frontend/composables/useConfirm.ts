type ConfirmOptions = {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: 'danger' | 'default'
}

let pendingResolve: ((v: boolean) => void) | null = null

export function useConfirm() {
  const open = useState<boolean>('confirm.open', () => false)
  const options = useState<ConfirmOptions | null>('confirm.options', () => null)

  function close(result: boolean) {
    open.value = false
    const r = pendingResolve
    pendingResolve = null
    options.value = null
    if (r) r(result)
  }

  function accept() {
    close(true)
  }

  function cancel() {
    close(false)
  }

  function confirm(opts: ConfirmOptions) {
    options.value = opts
    open.value = true
    return new Promise<boolean>((resolve) => {
      pendingResolve = resolve
    })
  }

  return { open, options, confirm, accept, cancel }
}

