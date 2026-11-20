/** Round avatar showing the first letter of a name; abbreviated addresses show "0x". */
export function Avatar({ name, large }: { name: string | null; large?: boolean }) {
  const clean = (name ?? '').replace(/^@/, '');
  const initial = clean.startsWith('0x') ? '0x' : clean ? [...clean][0] : '?';
  return (
    <span className={large ? 'avatar avatar-lg' : 'avatar'} aria-hidden="true">
      {initial}
    </span>
  );
}
