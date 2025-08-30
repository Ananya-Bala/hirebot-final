import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle, AlertCircle, Clock, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from 'react-markdown';
import { generatePDF } from "@/utils/pdfGenerator";
import { toast } from "@/hooks/use-toast";

interface AnalysisCardProps {
  title: string;
  description: string;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'fallback';
  result?: string;
  onStart?: () => void;
  onRetry?: () => void;
  isDisabled?: boolean;
  processingText?: string;
  showPDFButton?: boolean;
  sessionId?: string;
  candidateName?: string;
  jobTitle?: string;
}

export const AnalysisCard = ({
  title,
  description,
  status,
  result,
  onStart,
  onRetry,
  isDisabled,
  processingText = "Processing...",
  showPDFButton = false,
  sessionId,
  candidateName,
  jobTitle
}: AnalysisCardProps) => {
  const getStatusIcon = () => {
    switch (status) {
      case 'pending':
        return <Clock className="w-5 h-5 text-muted-foreground" />;
      case 'processing':
        return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-accent" />;
      case 'fallback':
        return <CheckCircle className="w-5 h-5 text-orange-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-destructive" />;
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'processing':
        return <Badge className="bg-primary/10 text-primary border-primary/20">Processing</Badge>;
      case 'completed':
        return <Badge className="bg-accent/10 text-accent border-accent/20">Completed</Badge>;
      case 'fallback':
        return <Badge className="bg-orange-100 text-orange-700 border-orange-300">Fallback Mode</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
    }
  };

  const handleGeneratePDF = async () => {
    if (!result) return;
    
    try {
      await generatePDF({
        title: title,
        content: result,
        sessionId: sessionId,
        candidateName: candidateName,
        jobTitle: jobTitle,
        dateGenerated: new Date().toLocaleDateString()
      });
      
      toast({
        title: "PDF Generated",
        description: "The report has been downloaded as a PDF.",
      });
    } catch (error) {
      toast({
        title: "PDF Generation Failed",
        description: "Failed to generate PDF. Please try again.",
        variant: "destructive"
      });
    }
  };

  return (
    <Card className={cn(
      "transition-all duration-300",
      status === 'processing' && "ring-2 ring-primary/20",
      status === 'completed' && "border-accent/30 bg-accent/5",
      status === 'fallback' && "border-orange-300 bg-orange-50"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {getStatusIcon()}
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription className="mt-1">{description}</CardDescription>
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent>
        {status === 'pending' && onStart && (
          <Button 
            onClick={onStart} 
            disabled={isDisabled}
            className="w-full"
          >
            Start Analysis
          </Button>
        )}
        
        {status === 'processing' && (
          <div className="flex items-center justify-center p-6 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            {processingText}
          </div>
        )}
        
        {(status === 'completed' || status === 'fallback') && result && (
          <div className="space-y-4">
            {status === 'fallback' && (
              <div className="bg-orange-100 border border-orange-200 p-3 rounded-lg text-orange-800 text-sm">
                <p>⚠️ Fallback mode was used due to API overload. You can retry for AI analysis when service is available.</p>
              </div>
            )}
            <div className="max-h-40 overflow-y-auto bg-muted rounded-lg p-4">
              <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown>{result.substring(0, 300) + "..."}</ReactMarkdown>
              </div>
            </div>
            <div className="flex gap-2">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="flex-1">
                    View Full Analysis
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[80vh]">
                  <DialogHeader>
                    <DialogTitle>{title} - Full Analysis</DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="h-[60vh] pr-4">
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown>{result}</ReactMarkdown>
                    </div>
                  </ScrollArea>
                </DialogContent>
              </Dialog>
              {showPDFButton && (
                <Button 
                  variant="outline"
                  onClick={handleGeneratePDF}
                  className="flex-1"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </Button>
              )}
              {status === 'fallback' && onRetry && (
                <Button 
                  variant="outline"
                  onClick={onRetry}
                  className="flex-1"
                >
                  Retry with AI
                </Button>
              )}
            </div>
          </div>
        )}
        
        {status === 'error' && (
          <div className="text-center p-6">
            <p className="text-sm text-destructive mb-4">
              An error occurred during analysis. Please try again.
            </p>
            <Button variant="outline" onClick={onRetry || onStart} className="w-full">
              Retry Analysis
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};