import React from 'react';
import ThobeMeasurementSelector from '../ThobeMeasurementSelector';
import { WomensMeasurementSelector } from './WomensMeasurementSelector';
import type { MeasurementSetKey } from '../../constants/measurementFields';

type ThobeProps = React.ComponentProps<typeof ThobeMeasurementSelector>;

/**
 * The shop's measurement selector (seen-open-verticals-task.md, wave 1):
 * verticals.capabilities.body_measurements picks it -- the thobe's
 * (ThobeMeasurementSelector, exactly as before: men's tailoring is unchanged)
 * or the women's (WomensMeasurementSelector). Same props for both; the
 * thobe's fabric estimate applies to the thobe only.
 */
export function MeasurementSelector({ set, ...props }: ThobeProps & { set: MeasurementSetKey | string | null | undefined }) {
  if (set === 'womens') {
    const { fabricEstimate: _thobeOnly, ...rest } = props;
    void _thobeOnly;
    return <WomensMeasurementSelector {...rest} />;
  }
  return <ThobeMeasurementSelector {...props} />;
}

export default MeasurementSelector;
