type EmptyProps = {
  children: string;
};

export function Empty({ children }: EmptyProps) {
  return <div className="empty">{children}</div>;
}
