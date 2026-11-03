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

export async function renderOgImagePng(title: string): Promise<Buffer> {
  const svg = await satori(
    // satori's TS types expect a React.ReactNode; this is a plain Node
    // build script with no React/JSX pragma, and satori's actual runtime
    // contract is a duck-typed {type,props} tree, not real React elements.
    {
      type: 'div',
      props: {
        style: {
          width: WIDTH,
          height: HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 80,
          backgroundColor: INK,
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                color: '#fff',
                fontSize: 56,
                fontWeight: 800,
                lineHeight: 1.3,
                direction: 'rtl',
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
    } as Parameters<typeof satori>[0],
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [{ name: 'Tajawal', data: getTajawalFont(), weight: 800, style: 'normal' }],
    }
  );

  return new Resvg(svg).render().asPng();
}
