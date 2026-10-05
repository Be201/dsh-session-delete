/**
 * Browser half of the Delete Session bundle.
 *
 * Two registration sites share one request store: the `...` menu row that raises
 * a confirmation, and the `shell.overlay` dialog that performs it. Deletion is
 * permanent, so the action never proceeds without that confirmation.
 *
 * Per Harness client-plugin practice this bundle imports no Harness Client
 * package. React arrives from the platform module table, and the row and dialog
 * are written here against `--dsw-alias-*` theme tokens only, copying the shape
 * of the host's own menu row and modal so the two sit together in one menu.
 *
 * The row the Host removes is one the Client must stop showing, and that happens
 * through two existing publications rather than any hand-rolled refresh: the
 * workspace registry's change (which drives `remote.workspace.follow`, and is
 * what drops the sidebar row) plus `ctx.sessions.refresh()` for the separate
 * Session baseline.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-session-delete',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Pathname the Host half registers the operation under, addressed document-relatively. */
    const DELETE_SESSION_PATH = '/api/session.delete';

    /** Dictionary namespace owned by this plugin. */
    const NS = 'sessionDelete';

    const zh = {
      'menu.deleteSession': '删除对话',
      'confirm.title': '删除此对话？',
      'confirm.desc': '“{title}”将被永久删除：对话记录、投影缓存与工作区归属都会被移除。此操作无法撤销，也不能恢复。',
      'confirm.warning': '如需保留，请改用「归档会话」。',
      'confirm.action': '永久删除',
      'confirm.pending': '正在删除…',
      'confirm.failed': '删除失败：{message}',
      'cancel': '取消',
      'close': '关闭',
    };

    const en = {
      'menu.deleteSession': 'Delete conversation',
      'confirm.title': 'Delete this conversation?',
      'confirm.desc': '“{title}” will be permanently deleted: its log, projection cache, and workspace accounting are all removed. This cannot be undone or restored.',
      'confirm.warning': 'Choose “Archive session” instead to keep it.',
      'confirm.action': 'Delete permanently',
      'confirm.pending': 'Deleting…',
      'confirm.failed': 'Delete failed: {message}',
      'cancel': 'Cancel',
      'close': 'Close',
    };

    /** Plugin-prefixed class names, deliberately not the host's hashed ones. */
    const cx = {
      item: 'dsd_item',
      itemIcon: 'dsd_itemIcon',
      itemLabel: 'dsd_itemLabel',
      root: 'dsd_root',
      mask: 'dsd_mask',
      dialog: 'dsd_dialog',
      header: 'dsd_header',
      title: 'dsd_title',
      close: 'dsd_close',
      description: 'dsd_description',
      warning: 'dsd_warning',
      footer: 'dsd_footer',
      status: 'dsd_status',
      error: 'dsd_error',
      button: 'dsd_button',
      danger: 'dsd_danger',
    };

    /**
     * Row and dialog styling. Values are copied from the host's own menu and
     * modal so the new row is indistinguishable from Archive beside it, and only
     * `--dsw-*` token references remain, so a renamed token degrades appearance
     * instead of breaking rendering.
     */
    const css = `
.dsd_item{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;cursor:pointer;font-size:13px;line-height:20px;text-align:left;color:var(--dsw-alias-state-error-primary)}
.dsd_item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsd_item:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);outline:none}
.dsd_item:disabled{opacity:.4;cursor:not-allowed}
.dsd_itemIcon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center}
.dsd_itemIcon svg{width:14px;height:14px}
.dsd_itemLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd_root{pointer-events:auto;position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top,24px)) 24px}
.dsd_mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;backdrop-filter:var(--dsw-mask-blur)}
.dsd_mask::after{content:'';position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1)}
.dsd_dialog{box-sizing:border-box;position:relative;z-index:1;display:flex;flex-direction:column;gap:16px;width:min(380px,100%);padding:0 0 24px;overflow:hidden;border:0;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}
.dsd_dialog:focus{outline:none}
.dsd_header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px}
.dsd_title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsd_close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary)}
.dsd_close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsd_close:disabled{opacity:.4;cursor:not-allowed}
.dsd_description{margin:0;padding:0 24px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dsd_warning{margin:0;padding:0 24px;font-size:13px;line-height:20px;color:var(--dsw-alias-state-warn-primary)}
.dsd_footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px}
.dsd_button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md);cursor:pointer;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);background:transparent}
.dsd_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsd_button:disabled{cursor:not-allowed;opacity:.4}
.dsd_danger:not(:disabled){color:var(--dsw-alias-state-error-primary)}
.dsd_danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsd_status{padding:0 24px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsd_error{padding:0 24px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
`;

    /** The host's trash outline artwork, redrawn at the host's 1px stroke. */
    function TrashIcon() {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        strokeWidth: 1,
        'aria-hidden': true,
        xmlns: 'http://www.w3.org/2000/svg',
      }, [
        h('path', { key: 'lid', d: 'M1.28149 3.88831H14.7187', stroke: 'currentColor' }),
        h('path', {
          key: 'handle',
          d: 'M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833',
          stroke: 'currentColor',
        }),
        h('path', {
          key: 'body',
          d: 'M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831',
          stroke: 'currentColor',
        }),
        h('path', { key: 'rib1', d: 'M6.44946 6.98926V11.1238', stroke: 'currentColor' }),
        h('path', { key: 'rib2', d: 'M9.55054 6.98926V11.1238', stroke: 'currentColor' }),
      ]);
    }

    /** The host dialog header's close glyph. */
    function CloseIcon() {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
        xmlns: 'http://www.w3.org/2000/svg',
      }, h('path', {
        d: 'M4 4L12 12M12 4L4 12',
        stroke: 'currentColor',
        strokeWidth: 1,
        strokeLinecap: 'round',
      }));
    }

    /**
     * Bind the row's render occurrence to the entries' `useMenuOpenState` hook:
     * the slot owner passes its open-state pair as the occurrence's hook context,
     * and this hands that same pair back to the component.
     *
     * @param _standard - framework standard props (unused).
     * @param state - the menu's open-state pair from the render occurrence.
     * @returns the hook the entries call.
     */
    const menuOpenStateFactory = (_standard, state) => () => state;

    /**
     * One minimal observable store: `getSnapshot` plus `subscribe`, the shape a
     * slot `hooks` entry is consumed through (`hooks.request` reaches the
     * component as `useRequest`). Kept local because a plugin bundle may not
     * import a Harness Client package.
     *
     * @param initial - the first snapshot.
     * @returns the store.
     */
    function createStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => value,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        set(next) {
          if (Object.is(value, next)) return;
          value = next;
          for (const listener of [...listeners]) listener();
        },
      };
    }

    /**
     * The `...` menu row. It raises the confirmation instead of deleting, so a
     * misplaced click can never destroy a Session.
     *
     * @param props - the Session id and title, the injected request actions, the
     * menu's open-state hook and the localized copy.
     * @returns the row.
     */
    function DeleteSessionMenuItem({ sessionId, displayTitle, requestDelete, useMenuOpenState, t }) {
      const [, setMenuOpen] = useMenuOpenState();
      return h('button', {
        type: 'button',
        className: cx.item,
        role: 'menuitem',
        onClick: () => {
          setMenuOpen(false);
          requestDelete(sessionId, displayTitle);
        },
      }, [
        h('span', { key: 'icon', className: cx.itemIcon }, h(TrashIcon, null)),
        h('span', { key: 'label', className: cx.itemLabel }, t('menu.deleteSession')),
      ]);
    }

    /**
     * The `shell.overlay` entry: one dialog per pending request, keyed by the
     * request so in-flight and error state die with it.
     *
     * @param props - the request hook, the injected actions and the copy.
     * @returns the open dialog, or nothing.
     */
    function DeleteSessionDialog({ useRequest, settleDelete, deleteSession, t }) {
      const request = useRequest((value) => value);
      if (request === null) return null;
      return h(DeleteConfirmForm, {
        key: request.sequence,
        request,
        settleDelete,
        deleteSession,
        t,
      });
    }

    /**
     * One request's dialog. Escape, the close control, and the mask all cancel;
     * none of them cancel while the deletion is already running.
     *
     * @param props - the request, the injected actions and the copy.
     * @returns the dialog.
     */
    function DeleteConfirmForm({ request, settleDelete, deleteSession, t }) {
      const [deleting, setDeleting] = React.useState(false);
      const [error, setError] = React.useState(null);
      const closeRef = React.useRef(null);

      const close = React.useCallback(() => {
        if (deleting) return;
        settleDelete();
      }, [deleting, settleDelete]);

      // The host modal moves focus into the card, so a keyboard user cannot act
      // on the page behind it.
      React.useEffect(() => {
        closeRef.current?.focus();
      }, []);
      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          close();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [close]);

      const confirm = () => {
        setDeleting(true);
        setError(null);
        deleteSession(request.sessionId).then(() => {
          settleDelete();
        }).catch((reason) => {
          setDeleting(false);
          setError(reason instanceof Error ? reason.message : String(reason));
        });
      };

      return h('div', { className: cx.root }, [
        h('div', { key: 'mask', className: cx.mask, onClick: close, 'aria-hidden': true }),
        h('div', {
          key: 'dialog',
          className: cx.dialog,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dsd-title',
          'aria-describedby': 'dsd-desc',
          tabIndex: -1,
        }, [
          h('div', { key: 'header', className: cx.header }, [
            h('h2', { key: 'title', id: 'dsd-title', className: cx.title }, t('confirm.title')),
            h('button', {
              key: 'close',
              ref: closeRef,
              type: 'button',
              className: cx.close,
              'aria-label': t('close'),
              disabled: deleting,
              onClick: close,
            }, h(CloseIcon, null)),
          ]),
          h('p', {
            key: 'desc',
            id: 'dsd-desc',
            className: cx.description,
          }, t('confirm.desc', { title: request.displayTitle })),
          h('p', { key: 'warning', className: cx.warning }, t('confirm.warning')),
          deleting && h('div', { key: 'status', className: cx.status, role: 'status' }, t('confirm.pending')),
          error !== null && h('div', { key: 'error', className: cx.error, role: 'alert' }, t('confirm.failed', { message: error })),
          h('div', { key: 'footer', className: cx.footer }, [
            h('button', {
              key: 'cancel',
              type: 'button',
              className: cx.button,
              disabled: deleting,
              onClick: close,
            }, t('cancel')),
            h('button', {
              key: 'confirm',
              type: 'button',
              className: `${cx.button} ${cx.danger}`,
              disabled: deleting,
              onClick: confirm,
            }, t('confirm.action')),
          ]),
        ]),
      ]);
    }

    /**
     * Insert this bundle's stylesheet once, tagged by bundle id.
     *
     * This is the shipped client-plugin pattern: the tag is owned by the bundle
     * so a re-registration does not duplicate it, and the returned disposer
     * removes it when the plugin unloads. `ctx.styles` is not a Client service —
     * it exists only inside the dynamic-plugin sandbox — so the document is the
     * interface here.
     *
     * @returns a disposer removing the tag.
     */
    function insertStylesheet() {
      const tagId = '@local/dsh-session-delete/styles.css';
      const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
      if (existing !== null) return () => existing.remove();
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/dsh-session-delete';
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    return {
      inject: ['slots', 'locale', 'sessions'],
      apply(ctx) {
        ctx.effect(() => insertStylesheet(), 'session-delete: stylesheet');
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-delete: dictionaries');

        // One request at a time: the dialog is modal, so a second request while
        // one is open is a race the user cannot reach deliberately.
        let sequence = 0;
        const requestStore = createStore(null);

        const requestDelete = (sessionId, displayTitle) => {
          sequence += 1;
          requestStore.set({
            sessionId,
            displayTitle: displayTitle ?? sessionId,
            sequence,
          });
        };

        /**
         * Hand one permanent deletion to the Host half, then re-pull the Session
         * baseline so the sidebar agrees with the disk.
         *
         * Two distinct Host publications are involved, and both are needed. The
         * sidebar's rows come from each workspace's ordered `sessionIds`, so the
         * row disappears because the Host released the workspace accounting —
         * that change travels the workspace's own `follow` stream, which the
         * workspace controller already runs. The `sessions` list is a separate
         * projection that nothing re-pulls on its own, so this half asks for it
         * explicitly.
         *
         * @param sessionId - the Session to delete.
         * @returns completion once the Session baseline has been re-read.
         */
        const deleteSession = async (sessionId) => {
          const response = await fetch(DELETE_SESSION_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });
          let payload = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }
          if (!response.ok || payload?.ok !== true) {
            throw new Error(payload?.message ?? `request failed with status ${String(response.status)}`);
          }
          // The Session is gone from disk at this point. Refreshing the separate
          // `sessions` baseline is best-effort on purpose: the sidebar row is
          // already removed by the Host's workspace-accounting publication, so a
          // failed refresh must not turn a completed deletion into an error the
          // user would read as "delete failed".
          await ctx.sessions.refresh().catch(() => {});
        };

        // Shared behavior for both sites; each adds only the hooks it consumes.
        const actions = {
          requestDelete,
          settleDelete: () => {
            requestStore.set(null);
          },
          deleteSession,
        };
        // The menu row also dismisses the menu, which it reaches through the
        // owner's `useMenuOpenState` hook.
        const menuFace = () => ({
          ...actions,
          hooks: {
            menuOpenState: menuOpenStateFactory,
          },
        });
        // The overlay dialog only reads the pending request.
        const dialogFace = () => ({
          ...actions,
          hooks: {
            request: requestStore,
          },
        });

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'session-delete',
          // Archive occupies 400, so 500 keeps Delete directly below it.
          order: 500,
          locale: NS,
          inject: menuFace,
        }, DeleteSessionMenuItem));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-delete-confirm',
          locale: NS,
          inject: dialogFace,
        }, DeleteSessionDialog));
      },
    };
  },
});
