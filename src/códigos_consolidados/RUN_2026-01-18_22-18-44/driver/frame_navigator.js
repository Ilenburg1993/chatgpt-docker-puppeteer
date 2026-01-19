FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\driver\modules\frame_navigator.js
PASTA_BASE: driver
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/driver/modules/frame_navigator.js
   Audit Level: 500 — Instrumented Frame Navigator (IPC 2.0)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Navegar em hierarquias complexas de IFrames e Shadow DOM,
                     calculando offsets físicos e reportando o progresso.
   Sincronizado com: BaseDriver V320, TelemetryBridge V500, analyzer.js V500.
========================================================================== */

const { log } = require('../../core/logger');

class FrameNavigator {
  /**
   * @param {object} driver - Instância do BaseDriver (acesso ao _emitVital).
   */
  constructor(driver) {
    this.driver = driver;
  }

  /**
   * Resolve o contexto de execução e calcula o deslocamento (offset) visual.
   * Narra a trajetória através dos frames para o Mission Control.
   * 
   * @param {object} protocol - Protocolo SADI contendo o framePath.
   * @returns {object} Contexto contendo { ctx, offsetX, offsetY, frameStack }.
   */
  async getExecutionContext(protocol) {
    const result = { 
      ctx: this.driver.page, 
      offsetX: 0, 
      offsetY: 0, 
      frameStack: [] 
    };

    // Caso base: Elemento está na raiz (Root)
    if (!protocol || protocol.context === 'root' || !protocol.framePath) {
      return result;
    }
    
    const correlationId = this.driver.correlationId;
    log('DEBUG', `[FRAME_NAV] Iniciando navegação de linhagem: ${protocol.framePath}`, correlationId);

    // [V500] Sinaliza início da navegação profunda
    this.driver._emitVital('PROGRESS_UPDATE', { 
        step: 'FRAME_NAVIGATION_START', 
        path: protocol.framePath 
    });

    try {
      const pathParts = protocol.framePath.split(' > ');
      let currentLevel = this.driver.page;

      for (const part of pathParts) {
        // Detecção de barreira lógica reportada pelo SADI
        if (part === 'barrier') {
            this.driver._emitVital('TRIAGE_ALERT', { 
                type: 'INFRA_BARRIER_DETECTED', 
                severity: 'HIGH',
                evidence: { reason: 'SADI_BARRIER_SIGNAL' }
            });
            break;
        }

        const targetSig = part.toLowerCase();
        
        // Localiza o frame no nível atual
        const frameJSHandle = await currentLevel.evaluateHandle((sig) => {
          const frames = Array.from(document.querySelectorAll('iframe'));
          return frames.find(f => {
            if (f.tagName.toLowerCase() !== 'iframe') return false;
            const id = f.id ? `#${f.id}` : '';
            const name = f.name ? `[name="${f.name}"]` : '';
            const currentSig = `${f.tagName}${id}${name}`.toLowerCase();
            return currentSig === sig;
          });
        }, targetSig);

        let element;
        try {
          element = frameJSHandle.asElement();
          
          if (element) {
            const nextFrame = await element.contentFrame();
            
            if (nextFrame) {
              // Registra o handle para cleanup automático posterior
              this.driver.handles.register(element);
              
              // Acumula o deslocamento físico (Bounding Box)
              const box = await element.boundingBox();
              if (box) { 
                result.offsetX += box.x; 
                result.offsetY += box.y; 
              }
              
              currentLevel = nextFrame;
              result.ctx = nextFrame;
              result.frameStack.push(element);

              // [V500] Reporta sucesso na entrada do nível
              this.driver._emitVital('PROGRESS_UPDATE', { 
                  step: 'FRAME_ENTERED', 
                  frame: targetSig, 
                  depth: result.frameStack.length 
              });

            } else {
              log('WARN', `[FRAME_NAV] Falha ao acessar conteúdo do frame: ${targetSig}`, correlationId);
              await element.dispose().catch(() => {});
              break;
            }
          } else {
            log('WARN', `[FRAME_NAV] Frame não localizado no nível atual: ${targetSig}`, correlationId);
            break;
          }
        } finally {
          try { 
            await frameJSHandle.dispose(); 
          } catch (dispErr) {}
        }
      }
    } catch (lineageErr) { 
      log('ERROR', `[FRAME_NAV] Colapso na navegação: ${lineageErr.message}`, correlationId);
      
      // [V500] Alerta de segurança: Provável bloqueio de Cross-Origin (CORS)
      if (lineageErr.message.includes('CSP') || lineageErr.message.includes('CORS')) {
        this.driver._emitVital('TRIAGE_ALERT', { 
            type: 'SECURITY_BARRIER_HIT', 
            severity: 'HIGH',
            evidence: { error: lineageErr.message, path: protocol.framePath }
        });
        throw lineageErr;
      }
    }
    
    this.driver._emitVital('PROGRESS_UPDATE', { 
        step: 'FRAME_NAVIGATION_COMPLETE', 
        depth: result.frameStack.length 
    });

    return result;
  }
}

module.exports = FrameNavigator;