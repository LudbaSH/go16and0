// Pointer-based drag and drop for the half-court. Pointer events are used instead
// of the HTML5 drag-and-drop API because that API does not work on touch screens.
// A drag only begins once the pointer moves past a small threshold, so a simple
// tap is left alone and handled as a click (used for select-to-move elsewhere).

const DragDrop = (() => {
  const DRAG_THRESHOLD = 6; // pixels of movement before a press becomes a drag

  // callbacks.getEligibleSlots() -> slot elements to highlight while dragging.
  // callbacks.onDrop(slotElement | null) -> called when a real drag ends.
  function makeDraggable(el, callbacks) {
    el.addEventListener("pointerdown", (event) => start(event, el, callbacks));
  }

  function start(startEvent, el, callbacks) {
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    let dragging = false;
    let eligible = [];
    let ghost = null;
    let hovered = null;

    function beginDrag() {
      dragging = true;
      eligible = callbacks.getEligibleSlots();
      eligible.forEach((slot) => slot.classList.add("eligible"));
      el.classList.add("dragging");
      ghost = el.cloneNode(true);
      ghost.classList.add("drag-ghost");
      ghost.classList.remove("dragging", "selected");
      document.body.appendChild(ghost);
    }

    function onMove(moveEvent) {
      if (!dragging) {
        const moved = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (moved < DRAG_THRESHOLD) return;
        beginDrag();
      }
      moveGhost(ghost, moveEvent.clientX, moveEvent.clientY);
      const slot = slotUnder(moveEvent.clientX, moveEvent.clientY, eligible);
      if (slot !== hovered) {
        if (hovered) hovered.classList.remove("drop-hover");
        if (slot) slot.classList.add("drop-hover");
        hovered = slot;
      }
    }

    function onUp(upEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!dragging) return; // a tap: let the click handler deal with it

      const slot = slotUnder(upEvent.clientX, upEvent.clientY, eligible);
      ghost.remove();
      el.classList.remove("dragging");
      eligible.forEach((s) => s.classList.remove("eligible", "drop-hover"));
      callbacks.onDrop(slot || null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function moveGhost(ghost, x, y) {
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
  }

  function slotUnder(x, y, eligible) {
    const stack = document.elementsFromPoint(x, y);
    for (const node of stack) {
      const slot = node.closest(".slot");
      if (slot && eligible.includes(slot)) return slot;
    }
    return null;
  }

  return { makeDraggable };
})();
