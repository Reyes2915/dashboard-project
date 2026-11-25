/** Reads the value of a native form control from a DOM event without unsafe type assertions. */
export function controlValue(event: Event): string {
  const target = event.target;
  if (
    target instanceof HTMLSelectElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return target.value;
  }
  return '';
}
