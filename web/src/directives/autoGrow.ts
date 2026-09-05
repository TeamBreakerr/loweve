import type { ObjectDirective } from 'vue';

const listeners = new WeakMap<HTMLTextAreaElement, EventListener>();
const frames = new WeakMap<HTMLTextAreaElement, number>();

export function fitTextarea(element: HTMLTextAreaElement) {
  element.style.height = 'auto';
  const borderHeight = element.offsetHeight - element.clientHeight;
  element.style.height = `${element.scrollHeight + borderHeight}px`;
}

function scheduleFit(element: HTMLTextAreaElement) {
  const pending = frames.get(element);
  if (pending !== undefined) cancelAnimationFrame(pending);
  frames.set(element, requestAnimationFrame(() => {
    frames.delete(element);
    fitTextarea(element);
  }));
}

export const vAutoGrow: ObjectDirective<HTMLTextAreaElement> = {
  mounted(element) {
    const onInput = () => fitTextarea(element);
    listeners.set(element, onInput);
    element.addEventListener('input', onInput);
    scheduleFit(element);
  },
  updated(element) {
    scheduleFit(element);
  },
  beforeUnmount(element) {
    const onInput = listeners.get(element);
    if (onInput) element.removeEventListener('input', onInput);
    listeners.delete(element);
    const pending = frames.get(element);
    if (pending !== undefined) cancelAnimationFrame(pending);
    frames.delete(element);
  },
};
