type ChoiceProps<T extends string | number> = {
  readonly legend: string;
  readonly choices: readonly { readonly id: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
};

/** One of a few options, as a row of buttons under a label. */
export function Choice<T extends string | number>({ legend, choices, value, onChange }: ChoiceProps<T>) {
  return (
    <fieldset className="field">
      <legend>{legend}</legend>
      <div className="segmented" role="group" aria-label={legend}>
        {choices.map((choice) => (
          <button key={choice.id} type="button" aria-pressed={choice.id === value} onClick={() => onChange(choice.id)}>
            {choice.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
