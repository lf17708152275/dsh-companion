// Browser half of dsh-companion: the persona-card editor on the plugin's page.
//
// Hand-written in the shape dsh's client loader expects (a closure handed to
// window.__ModuleLoader__ whose `require` only answers the shared modules).
// The exported cordis plugin adds one renderer to the `plugins.bundle.config`
// slot, keyed by the bundle package name, so it appears on this bundle's page
// in the Plugins settings. It must never throw: a failing client plugin blanks
// the whole web UI.
//
// Data lives behind the host half's routes (/x-dsh-companion/api): the list
// merges the bundled cards with local overrides, and every save re-registers
// that card's agent preset immediately.
window.__ModuleLoader__.load({ id: 'dsh-companion', factory: (require) => {
  const module = { exports: {} }
  const React = require('react')
  const h = React.createElement
  const API = '/x-dsh-companion/api'
  const BUNDLE_KEY = 'dsh-companion'
  const ROW_ID = 'companion'

  const S = {
    root: { fontSize: 13, lineHeight: 1.5, display: 'flex', gap: 16, alignItems: 'flex-start' },
    list: { width: 190, flex: '0 0 auto', maxHeight: 520, overflowY: 'auto', border: '1px solid var(--dsh-border, #ddd)', borderRadius: 6, padding: 4 },
    item: { display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', borderRadius: 4, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    itemActive: { background: 'var(--dsh-accent-soft, rgba(80,120,255,.14))' },
    pane: { flex: '1 1 auto', minWidth: 0, maxWidth: 760 },
    field: { display: 'block', marginBottom: 10 },
    label: { display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 3 },
    input: { width: '100%', boxSizing: 'border-box', padding: '5px 7px', fontSize: 13, borderRadius: 4, border: '1px solid var(--dsh-border, #ccc)', background: 'transparent', color: 'inherit' },
    textarea: { width: '100%', boxSizing: 'border-box', minHeight: 300, padding: '7px', fontSize: 12.5, lineHeight: 1.55, borderRadius: 4, border: '1px solid var(--dsh-border, #ccc)', background: 'transparent', color: 'inherit', resize: 'vertical' },
    row: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' },
    btn: { padding: '4px 12px', fontSize: 12, borderRadius: 4, border: '1px solid var(--dsh-border, #ccc)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
    btnPrimary: { padding: '4px 14px', fontSize: 12, borderRadius: 4, border: '1px solid transparent', background: 'var(--dsh-accent, #3b6cff)', color: '#fff', cursor: 'pointer' },
    badge: { display: 'inline-block', fontSize: 11, padding: '0 6px', borderRadius: 9, border: '1px solid var(--dsh-border, #ccc)', marginLeft: 6, opacity: 0.75 },
    hint: { fontSize: 12, opacity: 0.6, margin: '0 0 8px' },
    error: { color: 'var(--dsh-danger, #c62828)', fontSize: 12, margin: '0 0 8px' },
    status: { fontSize: 12, opacity: 0.7 },
  }

  function request(path, init) {
    return fetch(API + path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      ...init,
    }).then((response) => response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` })))
  }

  function Editor() {
    const [cards, setCards] = React.useState(null)
    const [selectedId, setSelectedId] = React.useState(null)
    const [draft, setDraft] = React.useState({ name: '', description: '', persona: '' })
    const [error, setError] = React.useState('')
    const [status, setStatus] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [meta, setMeta] = React.useState({ overridesDir: '', presetPrefix: 'card-' })

    const applySnapshot = (snapshot) => {
      if (!snapshot || snapshot.ok !== true || !Array.isArray(snapshot.cards)) {
        setError((snapshot && snapshot.message) || '加载失败')
        return
      }
      setError('')
      setCards(snapshot.cards)
      setMeta({ overridesDir: snapshot.overridesDir || '', presetPrefix: snapshot.presetPrefix || 'card-' })
      setSelectedId((current) => {
        if (current && snapshot.cards.some((card) => card.id === current)) return current
        return snapshot.cards.length > 0 ? snapshot.cards[0].id : null
      })
    }

    const load = React.useCallback(() => {
      setStatus('加载中…')
      request('/cards').then((snapshot) => {
        applySnapshot(snapshot)
        setStatus('')
      }, (cause) => {
        setError(String((cause && cause.message) || cause))
        setStatus('')
      })
    }, [])

    React.useEffect(() => {
      load()
    }, [load])

    const selected = cards ? cards.find((card) => card.id === selectedId) : undefined

    React.useEffect(() => {
      if (!selected) return
      setDraft({ name: selected.name || '', description: selected.description || '', persona: selected.persona || '' })
    }, [selectedId, cards])

    const dirty = Boolean(selected) && (
      draft.name !== selected.name
      || draft.description !== (selected.description || '')
      || draft.persona !== selected.persona
    )

    const save = () => {
      if (!selected) return
      setBusy(true)
      setStatus('保存中…')
      request('/cards/save', {
        method: 'POST',
        body: JSON.stringify({ id: selected.id, name: draft.name, description: draft.description, persona: draft.persona }),
      }).then((snapshot) => {
        setBusy(false)
        if (!snapshot || snapshot.ok !== true) {
          setStatus(`保存失败：${(snapshot && snapshot.message) || '未知错误'}`)
          return
        }
        applySnapshot(snapshot)
        setStatus(`已保存，preset ${meta.presetPrefix}${selected.id} 立即生效（新会话）`)
      }, (cause) => {
        setBusy(false)
        setStatus(`保存失败：${String((cause && cause.message) || cause)}`)
      })
    }

    const restore = () => {
      if (!selected) return
      setBusy(true)
      setStatus('恢复中…')
      request('/cards/reset', { method: 'POST', body: JSON.stringify({ id: selected.id }) }).then((snapshot) => {
        setBusy(false)
        if (!snapshot || snapshot.ok !== true) {
          setStatus(`恢复失败：${(snapshot && snapshot.message) || '未知错误'}`)
          return
        }
        applySnapshot(snapshot)
        setStatus(`已恢复内置版本，preset ${meta.presetPrefix}${selected.id} 已重新注册`)
      }, (cause) => {
        setBusy(false)
        setStatus(`恢复失败：${String((cause && cause.message) || cause)}`)
      })
    }

    if (error) return h('div', { style: S.root }, h('p', { style: S.error }, error), h('button', { type: 'button', style: S.btn, onClick: load }, '重试'))
    if (!cards) return h('p', { style: S.hint }, '加载中…')

    return h('div', { style: S.root },
      h('div', { style: S.list },
        h('button', { type: 'button', style: { ...S.item, opacity: 0.6 }, onClick: load, title: '重新读取卡片' }, '↻ 刷新'),
        cards.map((card) => h('button', {
          key: card.id,
          type: 'button',
          style: card.id === selectedId ? { ...S.item, ...S.itemActive } : S.item,
          onClick: () => setSelectedId(card.id),
          title: `${card.id} · ${card.name}`,
        }, `${card.id} ${card.name}${card.overridden ? ' *' : ''}`)),
      ),
      selected
        ? h('div', { style: S.pane },
          h('p', { style: S.hint },
            '人格卡正文 = 该 preset 的唯一系统提示词。保存后立即重新注册 preset，新会话生效；已开的会话沿用旧版本。',
          ),
          h('div', { style: S.field },
            h('span', { style: S.label }, '名字'),
            h('input', {
              style: S.input,
              value: draft.name,
              onChange: (event) => setDraft((current) => ({ ...current, name: event.target.value })),
            })),
          h('div', { style: S.field },
            h('span', { style: S.label }, `描述（显示在 preset 列表里）`),
            h('input', {
              style: S.input,
              value: draft.description,
              onChange: (event) => setDraft((current) => ({ ...current, description: event.target.value })),
            })),
          h('div', { style: S.field },
            h('span', { style: S.label },
              '人设正文',
              h('span', { style: S.badge }, `preset ${meta.presetPrefix}${selected.id}`),
              h('span', { style: S.badge }, selected.overridden ? '已覆盖内置' : '内置版本'),
              h('span', { style: S.badge }, `${draft.persona.length} 字`)),
            h('textarea', {
              style: S.textarea,
              value: draft.persona,
              onChange: (event) => setDraft((current) => ({ ...current, persona: event.target.value })),
            })),
          h('div', { style: S.row },
            h('button', { type: 'button', style: S.btnPrimary, disabled: busy || !dirty, onClick: save }, '保存'),
            h('button', { type: 'button', style: S.btn, disabled: busy || !dirty, onClick: () => selected && setDraft({ name: selected.name, description: selected.description || '', persona: selected.persona }) }, '撤销'),
            h('button', { type: 'button', style: S.btn, disabled: busy || !selected.overridden, onClick: restore }, '恢复内置'),
            h('span', { style: S.status }, status)),
          h('p', { style: { ...S.hint, marginTop: 8, wordBreak: 'break-all' } }, `覆盖文件：${meta.overridesDir}/${selected.id}.json`),
        )
        : h('p', { style: S.hint }, '这张卡库是空的。'),
    )
  }

  /** Settings-page wrapper: the section panel owns the chrome, so just pad. */
  function SheetedEditor() {
    return h('div', { style: { padding: '2px 4px 8px', maxWidth: 820 } }, h(Editor))
  }

  module.exports.name = 'dsh-companion-client'
  module.exports.inject = ['slots']
  module.exports.apply = function apply(ctx) {
    // DSH 0.2: the bundle's own page in Plugins renders `plugins.bundle.config`,
    // keyed by the bundle's package name.
    try {
      ctx.inject(['configForms'], (sctx) => {
        // Register on both ledgers this host renders: the bundle page
        // (`plugins.bundle.config`, keyed by package name) and the row page
        // (`plugins.row.config`, keyed by `<bundle>#<rowId>`).
        const ledgers = [
          ['plugins.bundle.config', { name: 'plugins.bundle.config', key: BUNDLE_KEY }],
          ['plugins.row.config', { name: 'plugins.row.config', key: `${BUNDLE_KEY}#${ROW_ID}` }],
        ]
        for (const [slotName, register] of ledgers) {
          try {
            sctx.slots.inject(slotName, () => sctx.slots.register(register,
              (props) => (props && props.view === 'page' ? h(Editor) : null),
            ))
          } catch (error) {
            try { console.warn(`[dsh-companion] ${slotName} editor disabled:`, error) } catch {}
          }
        }
      })
    } catch (error) {
      try { console.warn('[dsh-companion] client half disabled:', error) } catch {}
    }
    // Primary entry point: a first-class page in the Settings sidebar, the same
    // `settings.section` slot the built-in "A2A connection" / third-party
    // "bili settings" pages use. One click from the sidebar, no nesting.
    try {
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: BUNDLE_KEY, order: 20, label: '人格卡' },
        SheetedEditor,
      ))
    } catch (error) {
      try { console.warn('[dsh-companion] settings section disabled:', error) } catch {}
    }
  }
  return module.exports
} })
