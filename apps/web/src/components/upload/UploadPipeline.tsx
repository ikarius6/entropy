import { UploadProgress } from "../../hooks/useUploadPipeline";

interface UploadPipelineProps {
  progress: UploadProgress;
  onCancel: () => void;
}

export function UploadPipeline({ progress, onCancel }: UploadPipelineProps) {
  const stages = [
    { key: "chunking", label: "Fragmentación" },
    { key: "hashing", label: "Hashing" },
    { key: "storing", label: "Almacenando" },
    { key: "delegating", label: "Delegando seed" },
    { key: "publishing", label: "Publicando" },
  ];

  const getStageStatus = (stageIndex: number) => {
    const currentStageIndex = stages.findIndex(s => s.key === progress.stage);
    
    if (progress.stage === 'done') return 'completed';
    if (progress.stage === 'error') return currentStageIndex === stageIndex ? 'error' : 'pending';
    
    if (stageIndex < currentStageIndex) return 'completed';
    if (stageIndex === currentStageIndex) return 'active';
    return 'pending';
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {stages.map((stage, index) => {
          const status = getStageStatus(index);
          return (
            <div key={stage.key} className="flex items-center gap-4">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${status === 'completed' ? 'bg-green-500 text-white' : 
                  status === 'active' ? 'bg-primary text-background animate-pulse' : 
                  status === 'error' ? 'bg-red-500 text-white' : 'bg-white/10 text-muted'}`}
              >
                {status === 'completed' ? '✓' : index + 1}
              </div>
              <div className="flex-1">
                <div className="flex justify-between mb-1 text-sm font-medium">
                  <span className={status === 'active' ? 'text-white' : 'text-muted'}>{stage.label}</span>
                  {stage.key === 'chunking' && status === 'active' && (
                    <span className="text-muted text-xs">{Math.round(progress.chunkingProgress * 100)}%</span>
                  )}
                  {stage.key === 'storing' && (status === 'active' || status === 'completed') && (
                    <span className="text-muted text-xs">{progress.storedChunks} / {progress.totalChunks} chunks</span>
                  )}
                </div>
                
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ${
                      status === 'completed' ? 'bg-green-500 w-full' :
                      status === 'error' ? 'bg-red-500 w-full' :
                      status === 'active' && stage.key === 'chunking' ? 'bg-primary' :
                      status === 'active' && stage.key === 'storing' ? 'bg-primary' :
                      status === 'active' ? 'bg-primary w-full animate-pulse' :
                      'w-0'
                    }`}
                    style={{ 
                      width: status === 'active' && stage.key === 'chunking' ? `${progress.chunkingProgress * 100}%` :
                             status === 'active' && stage.key === 'storing' ? `${progress.storingProgress * 100}%` :
                             undefined
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="flex justify-between items-center mt-4 pt-4 border-t border-white/10">
        {progress.stage === 'done' ? (
          <div className="text-green-400 font-medium flex items-center gap-2">
            <span>🎉 Publicación completada</span>
          </div>
        ) : progress.stage === 'error' ? (
          <div className="text-red-400 font-medium">
            Error: {progress.error}
          </div>
        ) : (
          <div className="text-primary animate-pulse text-sm font-medium">
            Procesando... no cierres esta ventana
          </div>
        )}
        
        <button 
          onClick={onCancel}
          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-md transition-colors text-sm font-medium"
        >
          {progress.stage === 'done' || progress.stage === 'error' ? 'Volver' : 'Cancelar'}
        </button>
      </div>
    </div>
  );
}
