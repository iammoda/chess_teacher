// Pointer-based drag-and-drop for the chess board. Complements click-to-move:
// pointerdown on a piece arms a drag, movement past a small threshold starts it,
// pointerup over a square drops it. A press-and-release without movement is left
// to the square click handler, so click-to-move keeps working unchanged.
//
// Pointer capture is deliberately NOT used: capturing retargets the browser's
// synthesized click event away from the square buttons, which would break
// click-to-move. Move/up listeners live on window so drags that wander off the
// board still resolve or cancel cleanly.

const DRAG_START_DISTANCE = 5;

export function attachDragHandlers(boardEl, hooks) {
  const {
    canDragFrom, // (square) => boolean
    onDragStart, // (square) => void — select the piece / show legal dots
    onDrop, // (from, to) => void — attempt the move
    onDragCancel, // () => void — clear selection state
  } = hooks;

  let drag = null;

  boardEl.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    // Multi-touch guard: a second finger landing mid-drag must not replace
    // the drag object — that orphans the first drag's ghost element and its
    // source-piece styling forever. Non-primary pointers are ignored, and a
    // same-pointer re-press cleans up any leftover state first.
    if (event.isPrimary === false) return;
    if (drag) endDrag();
    const squareEl = event.target.closest("[data-square]");
    const pieceEl = squareEl?.querySelector(".piece");
    if (!squareEl || !pieceEl || !canDragFrom(squareEl.dataset.square)) return;

    drag = {
      from: squareEl.dataset.square,
      pieceEl,
      startX: event.clientX,
      startY: event.clientY,
      ghost: null,
      started: false,
      pointerId: event.pointerId,
    };
  });

  window.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (!drag.started) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) < DRAG_START_DISTANCE) return;
      startDrag(event);
    }

    event.preventDefault();
    positionGhost(event);
  }, { passive: false });

  window.addEventListener("pointerup", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const active = drag;
    const to = active.started ? squareAtPoint(event.clientX, event.clientY) : null;
    endDrag();

    if (!active.started) return; // plain click — the click handler owns it

    if (to && to !== active.from) {
      onDrop(active.from, to);
    } else {
      onDragCancel();
    }
  });

  window.addEventListener("pointercancel", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const started = drag.started;
    endDrag();
    if (started) onDragCancel();
  });

  function startDrag(event) {
    // A board re-render between pointerdown and the drag threshold replaces
    // the DOM nodes; cloning the detached original would produce an invisible
    // 0×0 ghost. Re-resolve the piece from the live board first.
    if (!drag.pieceEl.isConnected) {
      const freshSquare = boardEl.querySelector(`[data-square="${drag.from}"]`);
      const freshPiece = freshSquare?.querySelector(".piece");
      if (!freshPiece) {
        drag = null;
        return;
      }
      drag.pieceEl = freshPiece;
    }
    drag.started = true;
    onDragStart(drag.from);

    const rect = drag.pieceEl.getBoundingClientRect();
    const ghost = drag.pieceEl.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.append(ghost);
    drag.ghost = ghost;
    drag.pieceEl.classList.add("drag-source");
    boardEl.classList.add("dragging");
    positionGhost(event);
  }

  function positionGhost(event) {
    if (!drag?.ghost) return;
    drag.ghost.style.left = `${event.clientX - drag.ghost.offsetWidth / 2}px`;
    drag.ghost.style.top = `${event.clientY - drag.ghost.offsetHeight / 2}px`;
  }

  function squareAtPoint(x, y) {
    if (drag?.ghost) drag.ghost.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    return el?.closest("[data-square]")?.dataset.square || null;
  }

  function endDrag() {
    drag?.ghost?.remove();
    drag?.pieceEl?.classList.remove("drag-source");
    boardEl.classList.remove("dragging");
    drag = null;
  }

  return {
    isDragging: () => Boolean(drag?.started),
  };
}
