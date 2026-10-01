import { StepperNumber } from '@/components/ui/stepper-number';

type Props = {
  batchSize: number;
  onBatchChange: (v: number) => void;
  disabled?: boolean;
};

export function BatchControl({ batchSize, onBatchChange, disabled }: Props) {
  return (
    <StepperNumber
      id="batch"
      label="Batch count"
      value={batchSize}
      onChange={onBatchChange}
      min={1}
      max={8}
      step={1}
      defaultValue={1}
      disabled={disabled}
    />
  );
}
