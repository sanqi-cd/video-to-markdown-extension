import type { OutputLanguage } from '../core/language'

interface OutputLanguageSelectorProps {
  value: OutputLanguage
  onChange: (language: OutputLanguage) => void
}

const LANGUAGES: Array<{ value: OutputLanguage; label: string }> = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

export function OutputLanguageSelector({
  value,
  onChange,
}: OutputLanguageSelectorProps) {
  return (
    <section className="setting-group" aria-labelledby="output-language-title">
      <div className="setting-group__heading">
        <h3 id="output-language-title">输出语言</h3>
      </div>
      <div
        className="language-options"
        role="radiogroup"
        aria-labelledby="output-language-title"
      >
        {LANGUAGES.map((language) => (
          <label className="language-option" key={language.value}>
            <input
              type="radio"
              name="output-language"
              value={language.value}
              checked={value === language.value}
              onChange={() => onChange(language.value)}
            />
            <span>{language.label}</span>
          </label>
        ))}
      </div>
    </section>
  )
}
