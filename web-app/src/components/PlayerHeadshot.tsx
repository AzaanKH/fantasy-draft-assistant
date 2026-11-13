import * as React from 'react';
import { cn } from '@/lib/utils';

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The stand-in shown until (or instead of) a photo: the player's initials, or a defense's team abbreviation ("HOU"),
 * which reads better than "HD" for "HOU Defense".
 */
export function getHeadshotLabel(name: string, position?: string, team?: string): string {
  if (position === 'DEF') return (team ?? name.split(/\s+/)[0] ?? '').slice(0, 3).toUpperCase();
  return getInitials(name);
}

function getPlayerImageUrl(playerId: string, position?: string): string | null {
  if (position === 'DEF' || !/^\d+$/.test(playerId)) return null;
  // Keep the provider URL isolated so a licensed image service can replace it centrally.
  return `https://sleepercdn.com/content/nfl/players/${encodeURIComponent(playerId)}.jpg`;
}

export function PlayerHeadshot({
  playerId,
  name,
  position,
  team,
  className,
  imageClassName,
}: {
  readonly playerId: string;
  readonly name: string;
  readonly position?: string;
  /** A defense shows its team abbreviation instead of initials. */
  readonly team?: string;
  readonly className?: string;
  readonly imageClassName?: string;
}): React.ReactElement {
  const imageUrl = typeof document !== 'undefined' &&
    document.documentElement.hasAttribute('data-visual-test')
    ? null
    : getPlayerImageUrl(playerId, position);
  const [imageFailed, setImageFailed] = React.useState(false);
  const [imageLoaded, setImageLoaded] = React.useState(false);

  React.useEffect(() => {
    setImageFailed(false);
    setImageLoaded(false);
  }, [imageUrl]);

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-muted to-muted/45 text-xs font-bold text-muted-foreground',
        className
      )}
      aria-hidden="true"
    >
      {/* Always rendered underneath: a photo that is missing, slow, blocked or never answers leaves the initials
          (or the defense's team), never an empty circle. The photo covers them only once it has loaded. */}
      <span data-headshot-label="">{getHeadshotLabel(name, position, team)}</span>
      {imageUrl && !imageFailed ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn('absolute inset-0 size-full object-cover object-top', imageLoaded ? 'opacity-100' : 'opacity-0', imageClassName)}
          onLoad={() => {
            setImageLoaded(true);
          }}
          onError={() => {
            setImageFailed(true);
          }}
        />
      ) : null}
    </span>
  );
}
