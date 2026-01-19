/* public/js/app.js (Audit 9 - Wizard) */
const socket = io();
let currentTasks = [];
let selectedTaskId = null;

const els = {
    taskList: document.getElementById('taskList'),
    terminal: document.getElementById('terminal'),
    modal: document.getElementById('taskModal'),
    modalContent: document.getElementById('modalContent'),
    modalTitle: document.getElementById('modalTitle'),
    statusAgent: document.getElementById('status-agent'),
    uptime: document.getElementById('val-uptime'),
    memory: document.getElementById('val-memory'),
    btnStart: document.getElementById('btn-start'),
    btnStop: document.getElementById('btn-stop'),
    connStatus: document.createElement('div')
};

els.connStatus.style.cssText = "position:fixed; bottom:10px; right:10px; background:red; color:white; padding:5px 10px; border-radius:4px; font-size:0.8em; display:none; z-index:9999;";
els.connStatus.innerText = "Desconectado";
document.body.appendChild(els.connStatus);

socket.on('connect', () => els.connStatus.style.display = 'none');
socket.on('disconnect', () => els.connStatus.style.display = 'block');

// --- CORE ---
async function refresh() { await Promise.all([loadTasks(), updateStatus()]); }

async function updateStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const isOnline = data.agent === 'online';
        els.statusAgent.className = 'led ' + (isOnline ? 'on' : 'off');
        els.btnStart.disabled = isOnline;
        els.btnStop.disabled = !isOnline;
        els.uptime.innerText = data.uptime ? Math.floor(data.uptime/1000/60) + 'm' : '-';
        els.memory.innerText = data.memory ? Math.floor(data.memory/1024/1024) + 'MB' : '-';
    } catch(e) {}
}

async function loadTasks() {
    try {
        const res = await fetch('/api/tasks');
        currentTasks = await res.json();
        renderTasks();
    } catch(e) {}
}

function renderTasks() {
    els.taskList.innerHTML = '';
    const sorted = [...currentTasks].sort((a,b) => {
        const sA = a.state?.status, sB = b.state?.status;
        if (sA === 'RUNNING') return -1;
        if (sB === 'RUNNING') return 1;
        if (sA === 'PENDING' && sB !== 'PENDING') return -1;
        if (sB === 'PENDING' && sA !== 'PENDING') return 1;
        return (b.meta?.priority||0) - (a.meta?.priority||0);
    });

    if (sorted.length === 0) {
        els.taskList.innerHTML = '<div style="text-align:center; padding:20px; color:#555">Fila Vazia</div>';
        return;
    }

    sorted.forEach(t => {
        const div = document.createElement('div');
        const status = t.state?.status || 'UNKNOWN';
        
        let scheduleInfo = '';
        if (t.policy?.execute_after) {
            const date = new Date(t.policy.execute_after);
            if (date > new Date()) scheduleInfo = `<span style="color:#58a6ff">🕒 ${date.toLocaleTimeString()}</span>`;
        }
        
        let depInfo = '';
        if (t.policy?.dependencies?.length > 0) {
            depInfo = `<span style="color:#bc8cff; margin-left:5px;">🔗 ${t.policy.dependencies.length}</span>`;
        }

        div.className = `task-card ${status}`;
        div.onclick = () => openTaskModal(t.meta.id);
        div.innerHTML = `
            <div class="task-top">
                <span title="Copiar ID" onclick="event.stopPropagation(); copyToClipboard('${t.meta.id}')" style="cursor:copy">${t.meta.id}</span>
                <span>${status}</span>
            </div>
            <div class="task-body">${t.spec?.payload?.user_message || ''}</div>
            <div class="task-top" style="margin-top:5px">
                <span>${t.spec?.model} ${scheduleInfo} ${depInfo}</span>
                <span>Prio: ${t.meta?.priority}</span>
            </div>
        `;
        els.taskList.appendChild(div);
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    const toast = document.createElement('div');
    toast.innerText = "ID Copiado!";
    toast.style.cssText = "position:fixed; top:20px; right:20px; background:#238636; color:white; padding:5px 10px; border-radius:4px; z-index:10000; font-size:0.8rem;";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1500);
}

// --- MODAIS ---
function openTaskModal(id) {
    const task = currentTasks.find(t => t.meta.id === id);
    if (!task) return;
    selectedTaskId = id;
    els.modalTitle.innerText = "Editor JSON";
    
    const jsonString = JSON.stringify(task, null, 2);
    els.modalContent.innerHTML = `
        <textarea id="jsonEditor" style="width:100%; height:400px; background:#1e1e1e; color:#a5d6ff; border:none; font-family:monospace; padding:10px; resize:none; outline:none;">${jsonString}</textarea>
    `;
    els.modal.style.display = 'flex';
    
    const footer = document.getElementById('modalFooter');
    const isRunning = task.state.status === 'RUNNING';
    
    footer.innerHTML = `
        <button class="btn-neutral btn-sm" onclick="closeModal()">Cancelar</button>
        <button class="btn-start btn-sm" onclick="saveTaskChanges('${id}')" ${isRunning ? 'disabled' : ''}>Salvar</button>
        <div style="flex-grow:1"></div>
        <button class="btn-stop btn-sm" onclick="deleteTask('${id}')" ${isRunning ? 'disabled' : ''}>Deletar</button>
        ${task.state.status === 'FAILED' || task.state.status === 'DONE' ? 
          `<button class="btn-start btn-sm" onclick="retryTask('${id}')">Retentar</button>` : ''}
    `;
}

// WIZARD DE CRIAÇÃO
function openTaskWizard() {
    els.modalTitle.innerText = "Nova Tarefa Avançada";
    els.modalContent.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:10px; padding:10px;">
            <label>Prompt do Usuário *</label>
            <textarea id="wiz-prompt" rows="4"></textarea>
            
            <label>System Prompt (Persona)</label>
            <textarea id="wiz-system" rows="2"></textarea>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div>
                    <label>Modelo</label>
                    <select id="wiz-model">
                        <option value="gpt-5">GPT-5</option>
                        <option value="gpt-4o">GPT-4o</option>
                    </select>
                </div>
                <div>
                    <label>Prioridade</label>
                    <input type="number" id="wiz-prio" value="5">
                </div>
            </div>

            <label>Tags (separadas por vírgula)</label>
            <input type="text" id="wiz-tags" placeholder="livro, cap1, rascunho">

            <label>Depende de (IDs separados por vírgula)</label>
            <input type="text" id="wiz-deps" placeholder="TASK-123, TASK-456">
            
            <label>Agendar para</label>
            <input type="datetime-local" id="wiz-schedule">
        </div>
    `;
    els.modal.style.display = 'flex';
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn-neutral btn-sm" onclick="closeModal()">Cancelar</button>
        <button class="btn-start btn-sm" onclick="submitWizard()">Criar Tarefa</button>
    `;
}

async function submitWizard() {
    const prompt = document.getElementById('wiz-prompt').value;
    const system = document.getElementById('wiz-system').value;
    const model = document.getElementById('wiz-model').value;
    const prio = document.getElementById('wiz-prio').value;
    const tags = document.getElementById('wiz-tags').value.split(',').map(t=>t.trim()).filter(t=>t);
    const deps = document.getElementById('wiz-deps').value.split(',').map(t=>t.trim()).filter(t=>t);
    const schedule = document.getElementById('wiz-schedule').value;

    if (!prompt) return alert('Prompt obrigatório');

    const body = {
        prompt, system, model, priority: prio,
        tags, dependencies: deps,
        execute_after: schedule ? new Date(schedule).toISOString() : null
    };

    const res = await apiCall('/api/tasks', 'POST', body);
    if (res) { closeModal(); loadTasks(); }
}

async function openDiagnostics() {
    els.modalTitle.innerText = "Diagnóstico";
    els.modalContent.innerHTML = '<div style="padding:20px; text-align:center">Rodando diagnóstico...</div>';
    els.modal.style.display = 'flex';
    document.getElementById('modalFooter').innerHTML = '<button class="btn-neutral btn-sm" onclick="closeModal()">Fechar</button>';

    try {
        const res = await fetch('/api/health');
        const report = await res.json();
        let html = `<div style="padding:15px;">`;
        html += `<h3 style="color:${report.health === 'HEALTHY' ? 'var(--green)' : 'var(--red)'}">Status: ${report.health}</h3>`;
        html += `<ul style="list-style:none; padding:0;">`;
        html += `<li>🌐 Internet: ${report.checks.internet ? '✅ OK' : '❌ Falha'}</li>`;
        html += `<li>💾 Disco: ${report.checks.disk ? '✅ OK' : '❌ Falha'}</li>`;
        html += `<li>📂 Fila: ${report.checks.queue.corrupt === 0 ? '✅ OK' : '⚠️ ' + report.checks.queue.corrupt + ' Corrompidos'}</li>`;
        html += `</ul>`;
        if (report.issues.length > 0) {
            html += `<h4>Problemas:</h4><ul>`;
            report.issues.forEach(i => html += `<li style="color:var(--yellow)">${i}</li>`);
            html += `</ul>`;
        }
        html += `</div>`;
        els.modalContent.innerHTML = html;
    } catch(e) { els.modalContent.innerHTML = `<div style="color:red; padding:20px">Erro: ${e.message}</div>`; }
}

async function openCrashGallery() {
    const res = await fetch('/api/crashes');
    const crashes = await res.json();
    let html = '<div style="display:grid; gap:15px;">';
    if (crashes.length === 0) html += '<p style="text-align:center; color:#666">Nenhum erro registrado.</p>';
    crashes.forEach(c => {
        html += `
            <div style="background:#222; padding:15px; border-radius:6px; border:1px solid #444;">
                <div style="color:#f85149; font-weight:bold; margin-bottom:5px;">${c.error_msg}</div>
                <div style="font-size:0.8em; color:#8b949e; margin-bottom:10px;">${new Date(c.timestamp).toLocaleString()} • Task: ${c.taskId}</div>
                <a href="/logs/crash_reports/${c.dir}/screenshot.jpg" target="_blank"><img src="/logs/crash_reports/${c.dir}/screenshot.jpg" style="width:100%; border-radius:4px; border:1px solid #333;"></a>
            </div>
        `;
    });
    html += '</div>';
    els.modalContent.innerHTML = html;
    els.modal.style.display = 'flex';
    document.getElementById('modalFooter').innerHTML = '<button class="btn-neutral btn-sm" onclick="closeModal()">Fechar</button>';
}

async function saveTaskChanges(id) {
    try {
        const content = document.getElementById('jsonEditor').value;
        const json = JSON.parse(content);
        const res = await apiCall(`/api/tasks/${id}`, 'PUT', json);
        if (res) { closeModal(); loadTasks(); }
    } catch (e) { alert('JSON Inválido: ' + e.message); }
}

function closeModal() {
    els.modal.style.display = 'none';
    selectedTaskId = null;
}

async function apiCall(url, method, body) {
    try {
        const res = await fetch(url, {
            method,
            headers: {'Content-Type': 'application/json'},
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
        return data;
    } catch (e) { alert(`Erro: ${e.message}`); return null; }
}

async function control(action) {
    if (action.includes('kill') && !confirm('ATENÇÃO: Isso matará o processo. Continuar?')) return;
    await apiCall(`/api/control/${action}`, 'POST');
    setTimeout(updateStatus, 1000);
}

async function addTask() {
    const prompt = document.getElementById('inp-prompt').value;
    const system = document.getElementById('inp-system').value;
    const prio = document.getElementById('inp-prio').value;
    const model = document.getElementById('inp-model').value;
    const target = document.getElementById('inp-target').value;
    const schedule = document.getElementById('inp-schedule').value;

    if (!prompt) return alert('Prompt obrigatório');

    const body = { 
        prompt, system, priority: prio, model, target,
        execute_after: schedule ? new Date(schedule).toISOString() : null
    };

    const res = await apiCall('/api/tasks', 'POST', body);
    if (res) {
        document.getElementById('inp-prompt').value = '';
        loadTasks();
    }
}

async function deleteTask(id) {
    if(!confirm('Deletar tarefa?')) return;
    const res = await apiCall(`/api/tasks/${id}`, 'DELETE');
    if (res) { closeModal(); loadTasks(); }
}

async function retryTask(id) {
    const res = await apiCall(`/api/tasks/${id}/retry`, 'POST');
    if (res) { closeModal(); loadTasks(); }
}

async function clearQueue() {
    if(!confirm('TEM CERTEZA? Isso apagará TODAS as tarefas.')) return;
    const res = await apiCall('/api/queue/clear', 'POST');
    if (res && res.blocked > 0) alert(`${res.blocked} tarefas não foram apagadas pois estão rodando.`);
    loadTasks();
}

async function loadLogs() {
    try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        const wasAtBottom = els.terminal.scrollHeight - els.terminal.scrollTop === els.terminal.clientHeight;
        els.terminal.innerHTML = data.logs.map(l => {
            let c = '';
            if(l.includes('ERROR')) c = 'log-ERROR'; else if(l.includes('WARN')) c = 'log-WARN'; else if(l.includes('INFO')) c = 'log-INFO';
            return `<div class="log-line ${c}">${l}</div>`;
        }).join('');
        if (wasAtBottom) els.terminal.scrollTop = els.terminal.scrollHeight;
    } catch(e){}
}

socket.on('update', loadTasks);
socket.on('status_change', updateStatus);
socket.on('log_update', loadLogs);

setInterval(updateStatus, 2000);
refresh();
loadLogs();