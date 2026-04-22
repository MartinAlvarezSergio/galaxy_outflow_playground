import { ReactNode } from "react";

type ControlCardProps = {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
};

export function ControlCard({ title, subtitle, children }: ControlCardProps): JSX.Element {
  return (
    <section className="panel card">
      <h3>{title}</h3>
      {subtitle != null ? <div className="subtle">{subtitle}</div> : null}
      {children}
    </section>
  );
}
