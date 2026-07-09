import logoUrl from "../assets/logo.png";

type BrandLogoProps = {
  className?: string;
};

export function BrandLogo({ className = "" }: BrandLogoProps) {
  return (
    <img
      src={logoUrl}
      alt="Zunion"
      className={`object-contain ${className}`}
      draggable={false}
    />
  );
}
