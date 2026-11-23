import React, { useId } from 'react';

export function ForgeEmblem({ className = 'w-9 h-9' }: { className?: string }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      className={`${className} shrink-0`}
      viewBox="0 0 120 112"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${uid}-top`}
          x1="25"
          y1="50"
          x2="114"
          y2="9"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#0d6efd" />
          <stop offset="55%" stopColor="#00b8ff" />
          <stop offset="100%" stopColor="#25d0ff" />
        </linearGradient>
        <linearGradient
          id={`${uid}-spine`}
          x1="58"
          y1="38"
          x2="17"
          y2="106"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#25d0ff" />
          <stop offset="58%" stopColor="#0d6efd" />
          <stop offset="100%" stopColor="#072146" />
        </linearGradient>
        <linearGradient
          id={`${uid}-fold`}
          x1="60"
          y1="62"
          x2="90"
          y2="78"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#0d6efd" />
          <stop offset="100%" stopColor="#00b8ff" />
        </linearGradient>
      </defs>
      <polygon points="29,44 114,9 75,36 25,52" fill={`url(#${uid}-top)`} />
      <polygon points="114,9 97,34 55,51 75,36" fill="#072146" />
      <polygon points="4,77 12,61 40,49 32,63 26,77" fill="#072146" />
      <polygon points="40,49 43,50 33,77 26,77" fill="#0d6efd" />
      <polygon points="46,45 58,39 36,86 17,106" fill={`url(#${uid}-spine)`} />
      <polygon points="58,39 68,44 43,83 17,106" fill="#061a38" />
      <polygon points="54,57 88,43 81,58 50,71" fill="#072146" />
      <polygon points="60,67 78,59 90,77 65,77" fill={`url(#${uid}-fold)`} />
      <polygon points="78,59 90,77 74,72" fill="#25d0ff" />
    </svg>
  );
}

export const WEBSITE_LOGO_SRC = '/assets/aistudio/Screenshot_2026-11-20_141400_1e2e3f39.png';

export function BrandLogo({
  size = 'md',
  forceLightText = false,
}: {
  size?: 'sm' | 'md' | 'lg';
  forceLightText?: boolean;
}) {
  const frameCls =
    size === 'lg'
      ? 'w-64 sm:w-72 h-24 sm:h-[104px]'
      : size === 'sm'
        ? 'w-44 h-12'
        : 'w-52 sm:w-56 h-14 sm:h-16';

  const containerSurfaceCls = forceLightText
    ? 'bg-white px-2.5 py-0.5 rounded-lg shadow-xs'
    : 'dark:bg-white dark:px-2.5 dark:py-0.5 dark:rounded-lg dark:shadow-xs';

  const imgBlendCls = forceLightText
    ? 'mix-blend-normal'
    : 'mix-blend-multiply dark:mix-blend-normal';

  return (
    <div
      className={`inline-flex items-center justify-center select-none transition-colors ${containerSurfaceCls}`}
    >
      <div className={`${frameCls} overflow-hidden flex items-center justify-center shrink-0`}>
        <img
          src={WEBSITE_LOGO_SRC}
          alt="forgeXPay"
          draggable={false}
          referrerPolicy="no-referrer"
          className={`w-full h-full object-contain object-center ${imgBlendCls}`}
        />
      </div>
    </div>
  );
}
