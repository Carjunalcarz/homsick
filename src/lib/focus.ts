/**
 * For a sheet's or dialog's `onCloseAutoFocus`: focus the control that opened
 * it. The page may have re-rendered after a save, so it is looked up by id.
 */
export function returnFocus(event: Event, id: string | null | undefined) {
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  target.focus();
}
