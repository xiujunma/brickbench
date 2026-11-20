import type { ReactNode } from 'react';
import type { ModelInfo } from '../../core/cloud/protocol';
import { thumbnailUrl } from '../../state/cloudApi';
import { Icon } from '../components/Icon';

const DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function bricksText(count: number): string {
  return `${count.toLocaleString('en')} ${count === 1 ? 'brick' : 'bricks'}`;
}

export function dateText(time: number): string {
  return DATE.format(new Date(time));
}

type Props = {
  readonly model: ModelInfo;
  /** Under the name: who made it, when it was saved, how it stands. */
  readonly details: ReactNode;
  readonly actions: ReactNode;
  /** Shown under the actions, such as a report being written. */
  readonly children?: ReactNode;
};

/** A model online, as a picture with its name, a line about it and what can be done with it. */
export function ModelCard({ model, details, actions, children }: Props) {
  return (
    <li className="model-card" aria-label={model.name}>
      <div className="model-card-picture">
        {model.hasThumbnail ? (
          <img src={thumbnailUrl(model)} alt="" loading="lazy" width={240} height={180} />
        ) : (
          <Icon name="brick" size={40} />
        )}
      </div>
      <div className="model-card-text">
        <h3 className="model-card-name" title={model.name}>
          {model.name}
        </h3>
        <p className="model-card-details">{details}</p>
      </div>
      <div className="model-card-actions">{actions}</div>
      {children}
    </li>
  );
}
