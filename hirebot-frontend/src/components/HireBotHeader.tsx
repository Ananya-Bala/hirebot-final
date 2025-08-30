import { UserCheck, Bot } from "lucide-react";

export const HireBotHeader = () => {
  return (
    <header className="bg-gradient-primary text-primary-foreground shadow-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3">
            <div className="bg-white/20 p-3 rounded-xl">
              <Bot className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">HireBot</h1>
              <p className="text-white/90 text-lg">
                AI-Powered Interview Analysis Platform
              </p>
            </div>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center space-x-3">
              <UserCheck className="w-6 h-6 text-white/90" />
              <div>
                <h3 className="font-semibold">Smart Analysis</h3>
                <p className="text-sm text-white/80">
                  AI-driven candidate evaluation
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center space-x-3">
              <Bot className="w-6 h-6 text-white/90" />
              <div>
                <h3 className="font-semibold">Comprehensive Reports</h3>
                <p className="text-sm text-white/80">
                  Detailed insights and recommendations
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center space-x-3">
              <UserCheck className="w-6 h-6 text-white/90" />
              <div>
                <h3 className="font-semibold">Streamlined Process</h3>
                <p className="text-sm text-white/80">
                  Upload, analyze, and decide
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};