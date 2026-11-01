type BadgeProps = {
  value: string;
};

export function Badge({ value }: BadgeProps) {
  const className = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

  return <span className={`badge ${className}`}>{value}</span>;
}
