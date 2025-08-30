import { CheckCircle, Circle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  id: number;
  title: string;
  description: string;
  status: 'pending' | 'current' | 'completed';
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
}

export const StepIndicator = ({ steps, currentStep }: StepIndicatorProps) => {
  return (
    <div className="w-full py-8">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={step.id} className="flex flex-col items-center flex-1">
            <div className="flex items-center w-full">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex items-center justify-center w-12 h-12 rounded-full border-2 transition-all duration-300",
                    step.status === 'completed' && "bg-accent border-accent text-accent-foreground",
                    step.status === 'current' && "bg-primary border-primary text-primary-foreground animate-pulse",
                    step.status === 'pending' && "bg-muted border-border text-muted-foreground"
                  )}
                >
                  {step.status === 'completed' ? (
                    <CheckCircle className="w-6 h-6" />
                  ) : step.status === 'current' ? (
                    <Clock className="w-6 h-6" />
                  ) : (
                    <Circle className="w-6 h-6" />
                  )}
                </div>
                <div className="mt-3 text-center">
                  <h3 className={cn(
                    "text-sm font-semibold transition-colors",
                    step.status === 'current' && "text-primary",
                    step.status === 'completed' && "text-accent",
                    step.status === 'pending' && "text-muted-foreground"
                  )}>
                    {step.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-24">
                    {step.description}
                  </p>
                </div>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-4 transition-colors duration-300",
                    step.status === 'completed' ? "bg-accent" : "bg-border"
                  )}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};