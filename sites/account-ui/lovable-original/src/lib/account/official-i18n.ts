import { useEffect, useMemo, useState } from 'react';

export type OfficialPublicLocale = 'pt-BR' | 'en-US';

type OfficialPublicI18nRuntime = {
  schema: 'prototype-ordax.public-site-localization-runtime/1';
  sourceLocale: OfficialPublicLocale;
  supportedLocales: readonly OfficialPublicLocale[];
  getLocale(): OfficialPublicLocale;
  setLocale(value: string): OfficialPublicLocale;
  t(id: string, variables?: Record<string, unknown>): string;
  fromSource(source: string): string;
};

declare global {
  interface Window {
    OrdaXPublicI18n?: OfficialPublicI18nRuntime;
  }
}

function officialRuntime(): OfficialPublicI18nRuntime {
  const runtime = window.OrdaXPublicI18n;
  if (!runtime || runtime.schema !== 'prototype-ordax.public-site-localization-runtime/1') {
    throw new Error('official-public-i18n-runtime-missing');
  }
  return runtime;
}

export function useOfficialPublicI18n() {
  const runtime = useMemo(officialRuntime, []);
  const [locale, setLocaleState] = useState<OfficialPublicLocale>(() => runtime.getLocale());

  useEffect(() => {
    const handleLocaleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ locale?: string }>).detail;
      const next = detail?.locale;
      if (next === 'pt-BR' || next === 'en-US') setLocaleState(next);
    };
    document.addEventListener('ordax:localechange', handleLocaleChange);
    return () => document.removeEventListener('ordax:localechange', handleLocaleChange);
  }, []);

  return {
    locale,
    supportedLocales: runtime.supportedLocales,
    setLocale: (value: string) => runtime.setLocale(value),
    t: (id: string, variables?: Record<string, unknown>) => runtime.t(id, variables),
    fromSource: (source: string) => runtime.fromSource(source),
  } as const;
}
