import React from 'react';

interface SuggestionChipsProps {
    value: string;
    options: string[];
    onChange: (value: string) => void;
}

const tokenize = (s: string) => s.split(',').map(t => t.trim()).filter(Boolean);

// Clickable keyword chips that toggle themselves into/out of a comma-separated
// field. The text box stays the source of truth, so manual typing still works.
export const SuggestionChips: React.FC<SuggestionChipsProps> = ({ value, options, onChange }) => {
    const tokens = tokenize(value);
    const lower = tokens.map(t => t.toLowerCase());

    const toggle = (opt: string) => {
        if (lower.includes(opt.toLowerCase())) {
            onChange(tokens.filter(t => t.toLowerCase() !== opt.toLowerCase()).join(', '));
        } else {
            onChange([...tokens, opt].join(', '));
        }
    };

    return (
        <div className="flex flex-wrap gap-1.5">
            {options.map(opt => {
                const active = lower.includes(opt.toLowerCase());
                return (
                    <button
                        key={opt}
                        type="button"
                        onClick={() => toggle(opt)}
                        className={
                            active
                                ? 'rounded-full border border-violet-500/50 bg-violet-500/20 px-2.5 py-1 text-xs font-medium text-violet-200 transition'
                                : 'rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-400 transition hover:border-white/20 hover:bg-white/10 hover:text-slate-200'
                        }
                    >
                        {active ? '✓ ' : '+ '}{opt}
                    </button>
                );
            })}
        </div>
    );
};
