import React from 'react';

interface PromptInputSectionProps {
    title: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
}

export const PromptInputSection: React.FC<PromptInputSectionProps> = ({ title, icon, children }) => {
    return (
        <div className="flex flex-col gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                {icon && <span className="text-violet-400">{icon}</span>}
                {title}
            </h3>
            <div className="flex flex-col gap-3">
                {children}
            </div>
        </div>
    );
};
