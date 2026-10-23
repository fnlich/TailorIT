import { clsx } from 'clsx';
import { CaretDownIcon } from '@/components/ui/icons';

/*
 * The editor's dropdown controls in Simplify's look (screenshot 5: the font select, "Insert variable..." and "Base
 * from template..."): 38 px tall, white, a light grey border with a 6 px radius, a thin separator and a chevron.
 */

export const SHELL =
  'relative flex h-[38px] min-w-0 items-center rounded-[6px] border border-[#dedede] bg-white text-[14px] text-foreground ' +
  'transition-[border-color,box-shadow] duration-150 hover:border-[#c8c8c8] ' +
  'data-popup-open:border-[#969696] has-[input:focus]:border-[#969696] data-disabled:cursor-not-allowed data-disabled:opacity-55';

/** The separator and chevron at the right end of a shell. */
export function ShellIndicator({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={clsx('pointer-events-none flex h-full shrink-0 items-center', className)}>
      <span className="h-5 w-px bg-[#dedede]" />
      <span className="flex w-9 items-center justify-center text-[#9a9a9a]">
        <CaretDownIcon size={15} />
      </span>
    </span>
  );
}
