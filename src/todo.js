'use strict';
// To-do list, modelled on Google Keep checklists.
//
// - Collapsed: only the top unchecked item shows; the button on its right
//   expands the whole list (and shows how many more items there are).
// - Enter splits an item / starts a new one below, Backspace at the start
//   merges into the item above (or deletes an empty one), Delete at the end
//   pulls the next item up, ↑/↓ move between items.
// - Drag the grip (⠿) to reorder.
// - Checked items move to "completed" below. Both sections keep the list's
//   order, so unchecking puts an item back where it was.
// - "Clear" removes all completed items (with Undo for 5 seconds).
(() => {
  const $ = id => document.getElementById(id);
  const root = $('todo'), card = $('card'),
        openList = $('todoOpen'), doneList = $('todoDone'),
        expandBtn = $('todoExpand'), moreEl = $('todoMore'), addBtn = $('todoAdd'),
        doneHead = $('todoDoneHead'), doneToggle = $('todoDoneToggle'), doneCount = $('todoDoneCount'),
        clearBtn = $('todoClear');
  const api = window.overlay;

  let items = [];        // whole list in order: { id, text, done }
  let expanded = false;
  let showDone = true;
  let undoClear = null;  // { items, timer } for a few seconds after Clear
  let platform = '';
  api?.info().then(i => { platform = i.platform; });

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const openItems = () => items.filter(i => !i.done);
  const doneItems = () => items.filter(i => i.done);
  const byId = id => items.find(i => i.id === id);
  const rowOf = id => root.querySelector(`.todo-item[data-id="${CSS.escape(id)}"]`);

  // ---- saving ----
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api?.todosSave({ items, showDone }), 300);
  }

  // ---- drawing ----
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';
  const ICON_GRIP = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>';

  function row(item) {
    const li = document.createElement('li');
    li.className = 'todo-item' + (item.done ? ' is-done' : '');
    li.dataset.id = item.id;
    // Fixed markup only; the user's text goes in via .value below.
    li.innerHTML =
      (item.done ? '' : `<span class="todo-grip" title="Drag to reorder">${ICON_GRIP}</span>`) +
      `<button class="todo-check" role="checkbox" aria-checked="${item.done}" aria-label="${item.done ? 'Mark not done' : 'Mark done'}">${ICON_CHECK}</button>` +
      '<input class="todo-text" type="text" spellcheck="false" placeholder="List item" aria-label="To-do item">' +
      `<button class="todo-del" aria-label="Delete item" title="Delete">${ICON_X}</button>`;
    li.querySelector('.todo-text').value = item.text;
    return li;
  }

  // Remember which item has the caret so a redraw can put it back.
  function currentFocus() {
    const el = document.activeElement;
    if (!el || !el.classList.contains('todo-text') || !root.contains(el)) return null;
    return { id: el.closest('.todo-item').dataset.id, caret: el.selectionStart };
  }

  function render(focus = currentFocus()) {
    const open = openItems(), done = doneItems();
    openList.replaceChildren(...open.map(row));
    doneList.replaceChildren(...done.map(row));

    root.classList.toggle('expanded', expanded);
    root.classList.toggle('no-open', open.length === 0);
    root.classList.toggle('has-done', done.length > 0);
    root.classList.toggle('show-done', showDone);

    expandBtn.setAttribute('aria-expanded', String(expanded));
    expandBtn.setAttribute('aria-label', expanded ? 'Collapse list' : 'Show full list');
    expandBtn.title = expanded ? 'Collapse' : 'Show full list';
    const hidden = open.length ? open.length - 1 : done.length;
    moreEl.textContent = !expanded && hidden > 0 ? `+${hidden}` : '';

    doneHead.hidden = !(done.length || undoClear);
    doneCount.textContent = undoClear && !done.length ? 'Completed items cleared' : `${done.length} completed`;
    doneToggle.setAttribute('aria-expanded', String(showDone));
    clearBtn.textContent = undoClear ? 'Undo' : 'Clear';
    clearBtn.title = undoClear ? 'Bring the cleared items back' : 'Delete all completed items';

    if (focus) focusItem(focus.id, focus.caret);
  }

  function focusItem(id, caret = 'end') {
    const input = rowOf(id)?.querySelector('.todo-text');
    if (!input) return;
    input.focus();
    const pos = caret === 'end' || caret == null ? input.value.length : Math.min(caret, input.value.length);
    input.setSelectionRange(pos, pos);
  }

  // Typing needs keyboard focus. On Windows (and macOS panels) the overlay
  // doesn't take focus by itself, so ask for it first.
  async function ensureFocus() {
    if (!document.hasFocus() && api) await api.wantFocus(true);
  }

  // ---- editing the list ----
  // New items go right after `afterId`, or at the end of the unchecked items.
  function insertAfter(afterId, item) {
    let at = afterId ? items.findIndex(x => x.id === afterId) + 1 : 0;
    if (!afterId) {
      const lastOpen = items.map(x => !x.done).lastIndexOf(true);
      at = lastOpen + 1;
    }
    items.splice(at, 0, item);
  }

  function remove(id) {
    const i = items.findIndex(x => x.id === id);
    if (i >= 0) items.splice(i, 1);
  }

  async function addItem(afterId, text = '', caret = 0) {
    const item = { id: newId(), text, done: false };
    insertAfter(afterId, item);
    save();
    await ensureFocus();
    render({ id: item.id, caret });
    return item;
  }

  let toggleTimer;
  function toggleDone(id) {
    const item = byId(id);
    if (!item) return;
    item.done = !item.done;
    save();
    // Show the tick (or untick) for a moment, then move the item across.
    const li = rowOf(id);
    if (li) {
      li.classList.add(item.done ? 'checking' : 'unchecking');
      li.querySelector('.todo-check').setAttribute('aria-checked', String(item.done));
    }
    clearTimeout(toggleTimer);
    toggleTimer = setTimeout(() => render(), 260);
  }

  function clearDone() {
    if (undoClear) { // Undo
      clearTimeout(undoClear.timer);
      items = undoClear.items;
      undoClear = null;
      save();
      return render();
    }
    if (!doneItems().length) return;
    const before = items.slice();
    items = items.filter(i => !i.done);
    undoClear = { items: before, timer: setTimeout(() => { undoClear = null; render(); }, 5000) };
    save();
    render();
  }

  // ---- clicks ----
  root.addEventListener('click', e => {
    const check = e.target.closest('.todo-check');
    if (check) return toggleDone(check.closest('.todo-item').dataset.id);
    const del = e.target.closest('.todo-del');
    if (del) {
      remove(del.closest('.todo-item').dataset.id);
      save();
      return render();
    }
  });

  expandBtn.addEventListener('click', () => {
    expanded = !expanded;
    render();
  });

  addBtn.addEventListener('click', () => addItem(null));

  doneToggle.addEventListener('click', () => {
    showDone = !showDone;
    save();
    render();
  });

  clearBtn.addEventListener('click', clearDone);

  // Clicking into an item on Windows / macOS: get focus first, then place the caret.
  root.addEventListener('pointerdown', async e => {
    const input = e.target.closest('.todo-text');
    if (!input || document.hasFocus() || !api) return;
    if (platform !== 'win32' && platform !== 'darwin') return;
    e.preventDefault();
    await api.wantFocus(true);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, true);

  // ---- typing ----
  root.addEventListener('input', e => {
    const input = e.target.closest('.todo-text');
    if (!input) return;
    const item = byId(input.closest('.todo-item').dataset.id);
    if (item) { item.text = input.value; save(); }
  });

  root.addEventListener('keydown', e => {
    const input = e.target.closest('.todo-text');
    if (!input) return;
    const id = input.closest('.todo-item').dataset.id;
    const item = byId(id);
    if (!item) return;
    const list = item.done ? doneItems() : openItems();
    const idx = list.findIndex(x => x.id === id);
    const prev = list[idx - 1], next = list[idx + 1];
    const start = input.selectionStart, end = input.selectionEnd;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (item.done) return input.blur();
      // Split at the caret: text after it moves to a new item below.
      const after = input.value.slice(end);
      item.text = input.value.slice(0, start);
      expanded = true;
      addItem(id, after, 0);
    } else if (e.key === 'Backspace' && start === 0 && end === 0) {
      if (!input.value) {
        e.preventDefault();
        remove(id);
        save();
        render(prev ? { id: prev.id } : next ? { id: next.id, caret: 0 } : null);
      } else if (prev) {
        e.preventDefault();
        const caret = prev.text.length;
        prev.text += input.value;
        remove(id);
        save();
        render({ id: prev.id, caret });
      }
    } else if (e.key === 'Delete' && start === input.value.length && end === start && next) {
      e.preventDefault();
      const caret = input.value.length;
      item.text = input.value + next.text;
      remove(next.id);
      save();
      render({ id, caret });
    } else if (e.key === 'ArrowUp' && expanded && prev) {
      e.preventDefault();
      focusItem(prev.id);
    } else if (e.key === 'ArrowDown' && expanded && next) {
      e.preventDefault();
      focusItem(next.id);
    } else if (e.key === 'Escape') {
      input.blur();
    }
  });

  // Leaving an item: drop it if it's empty, and give focus back to the app
  // you were working in once you're done with the list.
  root.addEventListener('focusout', e => {
    const input = e.target.closest('.todo-text');
    setTimeout(() => {
      if (input) {
        const id = input.closest('.todo-item')?.dataset.id;
        const item = id && byId(id);
        if (item && !item.text.trim() && document.activeElement !== input) {
          remove(id);
          save();
          render();
        }
      }
      if (!root.contains(document.activeElement)) api?.wantFocus(false);
    }, 0);
  });

  // ---- drag to reorder (unchecked items, expanded list) ----
  openList.addEventListener('pointerdown', e => {
    const grip = e.target.closest('.todo-grip');
    if (!grip || !expanded) return;
    e.preventDefault();
    const li = grip.closest('.todo-item');
    const grabOffset = e.clientY - li.getBoundingClientRect().top;
    li.classList.add('dragging');
    try { grip.setPointerCapture(e.pointerId); } catch {}

    const move = ev => {
      li.style.transform = '';
      const top = ev.clientY - grabOffset;
      let prev = li.previousElementSibling, next = li.nextElementSibling;
      while (prev && top < prev.getBoundingClientRect().top + prev.offsetHeight / 2) {
        openList.insertBefore(li, prev);
        prev = li.previousElementSibling;
      }
      while (next && top + li.offsetHeight > next.getBoundingClientRect().top + next.offsetHeight / 2) {
        openList.insertBefore(next, li);
        next = li.nextElementSibling;
      }
      li.style.transform = `translateY(${top - li.getBoundingClientRect().top}px)`;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      li.classList.remove('dragging');
      li.style.transform = '';
      // Put the unchecked items back into their slots in the new order;
      // completed items keep their places.
      const order = [...openList.children].map(el => el.dataset.id);
      const map = new Map(items.map(i => [i.id, i]));
      let k = 0;
      items = items.map(i => (i.done ? i : map.get(order[k++])));
      save();
      render();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });

  // ---- window size follows the card ----
  if (api && 'ResizeObserver' in window) {
    let last = 0;
    new ResizeObserver(() => {
      const h = Math.ceil(card.getBoundingClientRect().height);
      if (h !== last) { last = h; api.setContentHeight(h); }
    }).observe(card);
  }

  // ---- load ----
  render();
  api?.todosLoad().then(data => {
    if (data && Array.isArray(data.items)) {
      items = data.items.map(i => ({ id: String(i.id), text: String(i.text || ''), done: !!i.done }));
      showDone = data.showDone !== false;
    }
    render(null);
  });
})();
