import { CheckIcon, ChevronIcon } from "./icons";
import { cx, FILTER } from "./ui";

interface FilterOption {
  label: string;
  /** Left off when the number would answer a question nobody asked. */
  count?: number;
  href: string;
  active: boolean;
}

interface FilterMenuProps {
  /** What is being narrowed, above the options. */
  title: string;
  /** What is in force, on the button. */
  label: string;
  options: FilterOption[];
  align?: "left" | "right";
}

/**
 * Every filter in the workspace has this shape: a button that opens a panel of
 * options, each with its count on the right and a check when it is the one in
 * force. The lists are single-select, so a checkbox would promise a choice the
 * control does not offer.
 *
 * A `details` element does the disclosure, so a filter opens, closes and takes
 * focus without a line of JavaScript — and it is anchored to the button that
 * opened it rather than to the view title, which is how the Source menu used
 * to open underneath the Status button.
 */
export function FilterMenu({
  title,
  label,
  options,
  align = "left",
}: FilterMenuProps) {
  return (
    <details className={FILTER.menu}>
      <summary aria-label={`${title}: ${label}`} className={FILTER.button}>
        {label}
        <span className={FILTER.chevron}>
          <ChevronIcon />
        </span>
      </summary>
      <div
        className={cx(
          FILTER.panel,
          align === "right" ? FILTER.panelRight : undefined,
        )}
      >
        <p className={FILTER.panelTitle}>{title}</p>
        {options.map((option) => (
          <a
            className={cx(
              FILTER.option,
              option.active ? FILTER.optionActive : undefined,
            )}
            href={option.href}
            key={option.label}
            {...(option.active ? { "aria-current": "true" as const } : {})}
          >
            <span className={FILTER.optionLabel}>{option.label}</span>
            {option.count === undefined ? null : (
              <span className={FILTER.optionCount}>{option.count}</span>
            )}
            <span className={FILTER.optionCheck}>
              {option.active ? <CheckIcon /> : null}
            </span>
          </a>
        ))}
      </div>
    </details>
  );
}
