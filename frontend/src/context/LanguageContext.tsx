import { createContext, useContext, useState } from 'react';
import { Lang, getT, TFn } from '../i18n';

interface LanguageCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const LanguageContext = createContext<LanguageCtx>({
  lang: 'sw',
  setLang: () => {},
  t: getT('sw'),
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem('boda_lang') as Lang | null) ?? 'sw',
  );

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('boda_lang', l);
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: getT(lang) }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  return useContext(LanguageContext);
}
