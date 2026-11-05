import type { FormEventHandler, ReactNode } from "react";
import { Settings } from "lucide-react";
import { BrandLogo } from "./BrandLogo";

/** Static, decorative backdrop: red corner waves + faint factory line art. No animation. */
function LoginBackdrop() {
  return (
    <div className="zl-backdrop" aria-hidden="true">
      <svg className="zl-wave zl-wave-tl" viewBox="0 0 520 420" preserveAspectRatio="xMinYMin slice" focusable="false">
        <defs>
          <linearGradient id="zlwTL1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ED1525" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ff6b78" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="zlwTL2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff8f9a" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffd5da" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <path d="M0 0H430C390 70 340 95 270 120C190 150 120 210 90 420H0Z" fill="url(#zlwTL2)" />
        <path d="M0 0H330C300 55 250 78 190 98C120 122 70 170 50 300C40 345 20 380 0 400Z" fill="url(#zlwTL1)" />
      </svg>
      <svg className="zl-wave zl-wave-br" viewBox="0 0 520 420" preserveAspectRatio="xMaxYMax slice" focusable="false">
        <defs>
          <linearGradient id="zlwBR1" x1="1" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ED1525" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ff6b78" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="zlwBR2" x1="1" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff8f9a" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffd5da" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <path d="M520 420H90C130 350 180 325 250 300C330 270 400 210 430 0H520Z" fill="url(#zlwBR2)" />
        <path d="M520 420H190C220 365 270 342 330 322C400 298 450 250 470 120C480 75 500 40 520 20Z" fill="url(#zlwBR1)" />
      </svg>

      {/* Left: industrial sewing machine + thread spools */}
      <svg className="zl-art zl-art-left" viewBox="0 0 360 300" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d="M30 230H330" />
        <path d="M30 230V250H330V230" />
        <path d="M60 230V190H300V230" />
        <path d="M70 190V120C70 100 84 88 104 88H250C290 88 306 112 306 148V190" />
        <path d="M250 88V70H290V88" />
        <path d="M280 88V30" />
        <path d="M262 30H298" />
        <path d="M80 190H300" />
        <path d="M120 88V60H190V88" />
        <circle cx="155" cy="40" r="20" />
        <circle cx="155" cy="40" r="8" />
        <path d="M280 190V215" />
        <path d="M274 215H286" />
        <path d="M120 150H210" />
        <path d="M120 168H190" />
        <circle cx="86" cy="150" r="22" />
        <circle cx="86" cy="150" r="7" />
        <ellipse cx="60" cy="278" rx="26" ry="9" />
        <path d="M34 278V258" />
        <path d="M86 278V258" />
        <ellipse cx="60" cy="258" rx="26" ry="9" />
        <path d="M44 268H76" />
        <ellipse cx="130" cy="280" rx="22" ry="8" />
        <path d="M108 280V262" />
        <path d="M152 280V262" />
        <ellipse cx="130" cy="262" rx="22" ry="8" />
        <path d="M116 271H144" />
      </svg>

      {/* Right: factory building + chimney */}
      <svg className="zl-art zl-art-right" viewBox="0 0 360 300" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d="M20 260H340" />
        <path d="M40 260V140L110 100V140L180 100V140L250 100V140H320V260" />
        <path d="M270 100V30H306V140" />
        <path d="M264 30H312" />
        <path d="M270 62H306" />
        <path d="M60 170H110V210H60Z" />
        <path d="M135 170H185V210H135Z" />
        <path d="M210 170H260V210H210Z" />
        <path d="M130 260V225H190V260" />
        <path d="M160 225V260" />
        <path d="M286 170H312V260" />
        <path d="M296 20C296 8 316 8 316 -2" />
        <path d="M230 40C218 34 218 18 232 14C236 2 256 2 258 14C270 14 274 30 262 36Z" />
      </svg>
    </div>
  );
}

type LoginShellProps = {
  children: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  /** Smaller headings/spacing for the recovery steps. */
  compact?: boolean;
};

/**
 * Shared frame for every login-screen step: backdrop, white card with red top accent,
 * the original Zunion "QUALITY FIRST" logo in a red rounded box, and the footer brand line.
 */
export function LoginShell({ children, onSubmit, compact }: LoginShellProps) {
  return (
    <main className="zl-page" dir="rtl">
      <LoginBackdrop />
      <form className={`zl-card${compact ? " zl-card-compact" : ""}`} onSubmit={onSubmit} noValidate>
        <div className="zl-logo">
          <BrandLogo className="zl-logo-img" />
        </div>
        {children}
        <div className="zl-footer" dir="ltr">
          <span className="zl-footer-line" />
          <Settings size={16} aria-hidden="true" />
          <span className="zl-footer-text">Zunion System Control</span>
          <span className="zl-footer-line" />
        </div>
      </form>
    </main>
  );
}
