import { readFileSync } from 'node:fs';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const WIDTH = 1200;
const HEIGHT = 630;
const INK = '#0E2A42';

// The reference design's ".ruler" element is pure CSS (three stacked
// repeating-linear-gradient backgrounds forming tick marks, not an SVG) --
// seen-blog-reference/02_المقالة_من_الداخل.html lines 54-58. Reproduced
// verbatim as the background of one element in the satori tree.
const RULER_BACKGROUND = [
  'repeating-linear-gradient(to left, #fff 0 1.5px, transparent 1.5px 100px)',
  'repeating-linear-gradient(to left, #fff 0 1px, transparent 1px 50px)',
  'repeating-linear-gradient(to left, #fff 0 1px, transparent 1px 10px)',
].join(', ');

let tajawalFont: Buffer | null = null;
function getTajawalFont(): Buffer {
  if (!tajawalFont) {
    tajawalFont = readFileSync('public/fonts/Tajawal-Bold.ttf');
  }
  return tajawalFont;
}

const PADDING = 80;

// Extracted as a pure, satori-independent tree builder so a long title's
// wrapping behavior can be asserted directly instead of only through a
// rendered PNG's pixels. The title div previously had no explicit width,
// so satori had nothing to wrap against and let long titles overflow the
// fixed 1200x630 canvas instead of wrapping onto a second/third line.
export function buildOgImageTree(title: string): object {
  return {
    type: 'div',
    props: {
      style: {
        width: WIDTH,
        height: HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: PADDING,
        backgroundColor: INK,
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              width: WIDTH - PADDING * 2,
              color: '#fff',
              fontSize: 56,
              fontWeight: 800,
              lineHeight: 1.3,
              direction: 'rtl',
              textAlign: 'right',
              display: 'flex',
              flexWrap: 'wrap',
            },
            children: title,
          },
        },
        {
          type: 'div',
          props: {
            style: {
              height: 20,
              marginTop: 36,
              opacity: 0.4,
              background: RULER_BACKGROUND,
            },
          },
        },
      ],
    },
  };
}

export async function renderOgImagePng(title: string): Promise<Buffer> {
  const svg = await satori(
    // satori's TS types expect a React.ReactNode; this is a plain Node
    // build script with no React/JSX pragma, and satori's actual runtime
    // contract is a duck-typed {type,props} tree, not real React elements.
    buildOgImageTree(title) as Parameters<typeof satori>[0],
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [{ name: 'Tajawal', data: getTajawalFont(), weight: 800, style: 'normal' }],
    }
  );

  return new Resvg(svg).render().asPng();
}
