import type { ComponentType, ReactElement, SVGProps } from 'react';
import {
  Anchor,
  Award,
  Bird,
  BookOpen,
  Cake,
  Castle,
  Cat,
  Clover,
  Compass,
  Crown,
  Eye,
  Feather,
  Fish,
  FlaskConical,
  Flame,
  Flower2,
  Gem,
  Gift,
  GraduationCap,
  Heart,
  Hourglass,
  Key,
  Lamp,
  Landmark,
  Leaf,
  Library,
  Lock,
  Mail,
  Moon,
  MoonStar,
  Mountain,
  PawPrint,
  Plane,
  Rabbit,
  Rocket,
  Scroll,
  Shell,
  Shield,
  Snowflake,
  Sparkles,
  Squirrel,
  Star,
  Sun,
  TreeDeciduous,
  TreePine,
  Trophy,
  Turtle,
  WandSparkles,
  Waves,
} from 'lucide-react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number; color?: string; strokeWidth?: number };

/** Custom 24×24 line glyphs drawn for this system (original artwork). */
function customIcon(paths: ReactElement): ComponentType<IconProps> {
  return function Custom({ size = 24, color = 'currentColor', strokeWidth = 2, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

const Owl = customIcon(
  <>
    <path d="M6.5 4.5 8.6 8M17.5 4.5 15.4 8" />
    <path d="M5.5 11.5C5.5 7.9 8.4 6 12 6s6.5 1.9 6.5 5.5v3.2c0 4.1-2.9 7.3-6.5 7.3s-6.5-3.2-6.5-7.3Z" />
    <circle cx="9.2" cy="11.3" r="2" />
    <circle cx="14.8" cy="11.3" r="2" />
    <path d="m12 13.4-.9 1.5h1.8Z" />
    <path d="M9 18.2c1 .7 2 1 3 1s2-.3 3-1M10.2 16.4h.01M13.8 16.4h.01" />
  </>,
);

const Stag = customIcon(
  <>
    <path d="M8 9.5 5 6.5M5 6.5 3.5 3.5M5 6.5 3 7.5M6.6 8 6 4.5" />
    <path d="M16 9.5l3-3M19 6.5l1.5-3M19 6.5l2 1M17.4 8 18 4.5" />
    <path d="M8 9.5c1 .7 2.4 1 4 1s3-.3 4-1l-.8 5.2c-.4 2.6-1.6 5.3-3.2 6.3-1.6-1-2.8-3.7-3.2-6.3Z" />
    <path d="M10.4 13.3h.01M13.6 13.3h.01M11.2 18.2h1.6" />
  </>,
);

const Quill = customIcon(
  <>
    <path d="M20 3c-6 1.5-10.5 6-12.5 12.5l1 1C15 14.5 19.5 10 21 4Z" />
    <path d="M8.5 16.5 4 21M11 12.5l3 1M13 9.5l3.5 1" />
  </>,
);

const Envelope = customIcon(
  <>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
    <path d="m3.5 7 8.5 6.5L20.5 7" />
    <circle cx="12" cy="13.5" r="2.2" />
  </>,
);

const Potion = customIcon(
  <>
    <path d="M10 3h4M10.5 3v4.2L6.6 12.6A5.5 5.5 0 1 0 17.4 12.6L13.5 7.2V3" />
    <path d="M7 14.5h10" />
    <circle cx="10.5" cy="17" r=".6" />
    <circle cx="13.5" cy="16" r=".6" />
  </>,
);

const Crescent = customIcon(
  <>
    <path d="M15 3.5A8.5 8.5 0 1 0 20.5 15 7 7 0 0 1 15 3.5Z" />
    <path d="m18 4 .6 1.4L20 6l-1.4.6L18 8l-.6-1.4L16 6l1.4-.6Z" />
  </>,
);

const Keyhole = customIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="10" r="2.4" />
    <path d="m11 12-1 5h4l-1-5" />
  </>,
);

const Rune = customIcon(
  <>
    <path d="M12 3v18M12 8l5-4M12 8 7 4M12 14l5 4M12 14l-5 4" />
  </>,
);

export interface SymbolDef {
  key: string;
  icon: ComponentType<IconProps>;
}

export const SYMBOLS: SymbolDef[] = [
  { key: 'owl', icon: Owl },
  { key: 'raven', icon: Bird as ComponentType<IconProps> },
  { key: 'stag', icon: Stag },
  { key: 'flame', icon: Flame as ComponentType<IconProps> },
  { key: 'tree', icon: TreeDeciduous as ComponentType<IconProps> },
  { key: 'pine', icon: TreePine as ComponentType<IconProps> },
  { key: 'waves', icon: Waves as ComponentType<IconProps> },
  { key: 'shell', icon: Shell as ComponentType<IconProps> },
  { key: 'key', icon: Key as ComponentType<IconProps> },
  { key: 'keyhole', icon: Keyhole },
  { key: 'star', icon: Star as ComponentType<IconProps> },
  { key: 'moon', icon: Moon as ComponentType<IconProps> },
  { key: 'moonstar', icon: MoonStar as ComponentType<IconProps> },
  { key: 'crescent', icon: Crescent },
  { key: 'sun', icon: Sun as ComponentType<IconProps> },
  { key: 'quill', icon: Quill },
  { key: 'feather', icon: Feather as ComponentType<IconProps> },
  { key: 'book', icon: BookOpen as ComponentType<IconProps> },
  { key: 'library', icon: Library as ComponentType<IconProps> },
  { key: 'castle', icon: Castle as ComponentType<IconProps> },
  { key: 'landmark', icon: Landmark as ComponentType<IconProps> },
  { key: 'crown', icon: Crown as ComponentType<IconProps> },
  { key: 'shield', icon: Shield as ComponentType<IconProps> },
  { key: 'wand', icon: WandSparkles as ComponentType<IconProps> },
  { key: 'sparkles', icon: Sparkles as ComponentType<IconProps> },
  { key: 'potion', icon: Potion },
  { key: 'flask', icon: FlaskConical as ComponentType<IconProps> },
  { key: 'scroll', icon: Scroll as ComponentType<IconProps> },
  { key: 'envelope', icon: Envelope },
  { key: 'mail', icon: Mail as ComponentType<IconProps> },
  { key: 'hourglass', icon: Hourglass as ComponentType<IconProps> },
  { key: 'compass', icon: Compass as ComponentType<IconProps> },
  { key: 'eye', icon: Eye as ComponentType<IconProps> },
  { key: 'lock', icon: Lock as ComponentType<IconProps> },
  { key: 'rune', icon: Rune },
  { key: 'snowflake', icon: Snowflake as ComponentType<IconProps> },
  { key: 'gift', icon: Gift as ComponentType<IconProps> },
  { key: 'cake', icon: Cake as ComponentType<IconProps> },
  { key: 'heart', icon: Heart as ComponentType<IconProps> },
  { key: 'clover', icon: Clover as ComponentType<IconProps> },
  { key: 'leaf', icon: Leaf as ComponentType<IconProps> },
  { key: 'flower', icon: Flower2 as ComponentType<IconProps> },
  { key: 'mountain', icon: Mountain as ComponentType<IconProps> },
  { key: 'gem', icon: Gem as ComponentType<IconProps> },
  { key: 'trophy', icon: Trophy as ComponentType<IconProps> },
  { key: 'award', icon: Award as ComponentType<IconProps> },
  { key: 'graduation', icon: GraduationCap as ComponentType<IconProps> },
  { key: 'lamp', icon: Lamp as ComponentType<IconProps> },
  { key: 'anchor', icon: Anchor as ComponentType<IconProps> },
  { key: 'cat', icon: Cat as ComponentType<IconProps> },
  { key: 'rabbit', icon: Rabbit as ComponentType<IconProps> },
  { key: 'squirrel', icon: Squirrel as ComponentType<IconProps> },
  { key: 'turtle', icon: Turtle as ComponentType<IconProps> },
  { key: 'fish', icon: Fish as ComponentType<IconProps> },
  { key: 'paw', icon: PawPrint as ComponentType<IconProps> },
  { key: 'plane', icon: Plane as ComponentType<IconProps> },
  { key: 'rocket', icon: Rocket as ComponentType<IconProps> },
];

const BY_KEY = new Map(SYMBOLS.map((s) => [s.key, s]));

export function symbolIcon(key: string | undefined): ComponentType<IconProps> {
  return (key && BY_KEY.get(key)?.icon) || Owl;
}

/** Renders a symbol centred in the box (x, y, size) – usable inside any SVG. */
export function SymbolGlyph({ symbol, x, y, size, color, strokeWidth = 1.6, opacity }: { symbol: string; x: number; y: number; size: number; color: string; strokeWidth?: number; opacity?: number }) {
  const Icon = symbolIcon(symbol);
  return <Icon x={x} y={y} width={size} height={size} size={size} color={color} stroke={color} strokeWidth={strokeWidth} opacity={opacity} aria-hidden="true" />;
}
