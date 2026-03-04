// --- Supabase Config ---
console.log("Supabase config loading...");
const SUPABASE_URL = 'https://yhrxfnjpgurchgzvjtqw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlocnhmbmpwZ3VyY2hnenZqdHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTU4MjQsImV4cCI6MjA4ODE3MTgyNH0.ig6y9DCHNX-nyN3Rt48Dp7FGA-ZpAqMkFjSmzsAKREw';
let supabase;
try {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log("Supabase client created successfully.");
} catch (e) {
  console.error("Supabase client creation failed:", e);
}

// --- API Layer ---
const api = {
  async getCurrentUser() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data: userRecord } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single();

    return { ...session.user, ...userRecord };
  },
  async getMarkets() {
    const { data, error } = await supabase.from('markets').select('*').order('name');
    if (error) throw error;
    return data;
  },
  async getTopics(marketId) {
    const { data, error } = await supabase.from('topics').select('*').eq('market_id', marketId).order('name');
    if (error) throw error;
    return data;
  },
  async getPrompts(marketId, topicId, searchQuery = '') {
    let query = supabase.rpc('search_prompts', {
      p_market_id: marketId,
      p_topic_id: topicId,
      p_search_text: searchQuery || null
    });

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },
  async getPromptVersions(promptId) {
    const { data, error } = await supabase
      .from('prompt_versions')
      .select('v:version, c:content, date:created_at')
      .eq('prompt_id', promptId)
      .order('version', { ascending: false });
    if (error) throw error;
    return data;
  },
  async savePrompt({ id, topic_id, title, content }) {
    if (id) {
      const { data, error } = await supabase
        .from('prompts')
        .update({ title, content })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('prompts')
        .insert({ topic_id, title, content })
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  },
  async deletePrompt(id) {
    const { error } = await supabase.from('prompts').delete().eq('id', id);
    if (error) throw error;
    return true;
  },
  async getUserRole(marketId) {
    const { data } = await supabase
      .from('user_market_roles')
      .select('role')
      .eq('market_id', marketId)
      .maybeSingle();
    return data?.role || null;
  },
  async getUsers() {
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }
};

// Application State
const state = {
  user: null,
  isSuperAdmin: false,
  userRoles: [], // array of market_ids where user has access
  markets: [],
  topics: [],
  prompts: [],
  searchQuery: '',
  selectedMarketId: null,
  selectedTopicId: null,
  selectedPromptId: null,
  view: 'loading',
  currentRole: null, // role in the selected market ('view' or 'edit' or 'superadmin')
  isEditingNew: false,
};

const appDiv = document.getElementById('app');

// Initialization
async function init() {
  console.log("init() starting...");
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await handleLogin(session.user);
    } else {
      state.view = 'login';
      render();
    }
  } catch (err) {
    console.error("Init failed:", err);
    state.view = 'login';
    render();
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log("Auth event:", event);
    if (session && !state.user) {
      await handleLogin(session.user);
    } else if (!session && state.user) {
      state.user = null;
      state.view = 'login';
      render();
    }
  });
}

async function handleLogin(authUser) {
  state.view = 'loading';
  render();
  try {
    const user = await api.getCurrentUser();
    state.user = user;
    state.isSuperAdmin = user.is_super_admin;

    // Load markets
    state.markets = await api.getMarkets();

    // Load roles to filter tabs if not superadmin
    if (!state.isSuperAdmin) {
      const { data: roles } = await supabase.from('user_market_roles').select('*').eq('user_id', user.id);
      state.userRoles = roles || [];
      // Filter markets to only those user has a role in
      const allowedMarketIds = state.userRoles.map(r => r.market_id);
      state.markets = state.markets.filter(m => allowedMarketIds.includes(m.id));
    }

    if (state.markets.length > 0) {
      state.selectedMarketId = state.markets[0].id;
    }

    state.view = 'app';
    await loadMarketData();
  } catch (err) {
    console.error('Error in login flow', err);
    state.view = 'login';
    render();
  }
}

async function loadMarketData() {
  if (!state.selectedMarketId) {
    render();
    return;
  }

  if (state.isSuperAdmin) {
    state.currentRole = 'superadmin';
  } else {
    const roleOpt = state.userRoles.find(r => r.market_id === state.selectedMarketId);
    state.currentRole = roleOpt ? roleOpt.role : null;
  }

  state.topics = await api.getTopics(state.selectedMarketId);
  state.selectedPromptId = null;
  state.isEditingNew = false;

  await loadPromptsData();
}

async function loadPromptsData() {
  state.prompts = await api.getPrompts(state.selectedMarketId, state.selectedTopicId, state.searchQuery);
  render();
}

// ==== Rendering ====

function render() {
  appDiv.innerHTML = '';
  let content = '';

  if (state.view === 'loading') content = renderLoading();
  else if (state.view === 'login') content = renderLogin();
  else if (state.view === 'app') content = renderMainApp();
  else if (state.view === 'admin') content = renderAdminPanel();

  if (content && typeof content !== 'string') {
    appDiv.appendChild(content);
  } else if (content) {
    appDiv.innerHTML = content;
  }


  if (window.lucide) {
    try { window.lucide.createIcons(); } catch (e) { }
  }
}

function createElementFromHTML(htmlString) {
  const div = document.createElement('div');
  div.innerHTML = htmlString.trim();
  return div.firstChild;
}

// ------------------------
// UI Components
// ------------------------

function renderLoading() {
  return createElementFromHTML(`
    <div class="flex h-screen items-center justify-center bg-slate-50">
      <div class="flex flex-col items-center space-y-4 fade-in">
        <i data-lucide="loader-2" class="h-8 w-8 animate-spin text-brand-600"></i>
        <p class="text-slate-500 font-medium tracking-wide">Loading Library...</p>
      </div>
    </div>
  `);
}

function renderLogin() {
  const el = createElementFromHTML(`
    <div class="flex min-h-screen items-center justify-center p-4 relative overflow-hidden bg-slate-50">
      <div class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-200 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob"></div>
      <div class="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob" style="animation-delay: 2s;"></div>
      
      <div class="w-full max-w-md glass-panel p-8 rounded-2xl relative z-10 fade-in">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-100 text-brand-600 mb-4 shadow-sm">
            <i data-lucide="library" class="h-6 w-6"></i>
          </div>
          <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 tracking-tight">Topas Library</h1>
          <p class="text-slate-500 mt-2">Sign in to manage and view prompts</p>
        </div>
        
        <button id="btn-login-google" class="w-full flex justify-center py-2.5 px-4 border border-slate-300 rounded-lg shadow-sm bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 mb-4 items-center gap-2">
          <img src="https://www.svgrepo.com/show/475656/google-color.svg" class="h-5 w-5" alt="Google">
          Continue with Google
        </button>
      </div>
    </div>
  `);

  setTimeout(() => {
    document.getElementById('btn-login-google').addEventListener('click', async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        // In local static mode, default origin might be `file://` which causes failure.
        // It's safest to leave options blank or default to origin dynamically.
      });
      if (error) alert(error.message);
    });
  }, 0);

  return el;
}

function renderMainApp() {
  const el = document.createElement('div');
  el.className = 'flex flex-col h-screen fade-in bg-white text-slate-900';

  el.innerHTML = `
    <!-- Header -->
    <header class="bg-white border-b border-slate-200 z-10 flex-shrink-0">
      <div class="px-4 sm:px-6">
        <div class="flex items-center justify-between h-14">
          <div class="flex items-center gap-3">
            <div class="bg-gradient-to-br from-brand-500 to-brand-700 p-1.5 rounded-lg text-white shadow-sm">
              <i data-lucide="layers" class="h-5 w-5"></i>
            </div>
            <span class="font-bold text-slate-900 text-lg tracking-tight hidden sm:block">Topas</span>
          </div>
          
          <div class="flex-1 flex justify-center ml-4 mr-4 space-x-1 overflow-x-auto no-scrollbar" id="market-tabs"></div>
          
          <div class="flex items-center gap-3 border-l border-slate-200 pl-4">
            ${state.isSuperAdmin ? `<button id="btn-admin" class="text-sm font-medium text-slate-600 hover:text-brand-600 flex items-center gap-1.5 transition-colors border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50"><i data-lucide="shield" class="h-4 w-4"></i> Admin</button>` : ''}
            <div class="relative group cursor-pointer">
              <div class="h-8 w-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold border border-brand-200">
                ${state.user.email.charAt(0).toUpperCase()}
              </div>
              <div class="hidden group-hover:block absolute right-0 w-56 mt-1 origin-top-right rounded-xl shadow-lg shadow-black/5 ring-1 ring-slate-200 bg-white z-50">
                <div class="px-4 py-3 border-b border-slate-100">
                  <p class="text-sm text-slate-900 font-medium truncate">${state.user.name || 'User'}</p>
                  <p class="text-xs text-slate-500 truncate mt-0.5">${state.user.email}</p>
                </div>
                <div class="py-1">
                  <button id="btn-logout" class="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">Sign out</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
    
    <!-- Body Layout -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left Sidebar: Topics -->
      <aside class="w-64 border-r border-slate-200 bg-slate-50/50 flex flex-col flex-shrink-0">
        <div class="px-4 py-3 border-b border-slate-200 flex justify-between items-center bg-white">
          <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Topics</h2>
          ${(state.currentRole === 'edit' || state.currentRole === 'superadmin') ? `
            <button id="btn-add-topic" class="text-slate-400 hover:text-brand-600 transition-colors bg-slate-100 hover:bg-brand-50 p-1 rounded">
              <i data-lucide="plus" class="h-4 w-4"></i>
            </button>
          ` : ''}
        </div>
        <div class="flex-1 overflow-y-auto p-2" id="topic-list"></div>
      </aside>
      
      <!-- Middle Panel: Prompts List -->
      <section class="flex flex-col border-r border-slate-200 bg-white w-[350px] flex-shrink-0">
        <div class="p-3 border-b border-slate-200 bg-white">
          <div class="relative">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <i data-lucide="search" class="h-4 w-4 text-slate-400"></i>
            </div>
            <input type="text" id="input-search" value="${state.searchQuery}" class="block w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg leading-5 bg-slate-50 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-brand-500 focus:border-brand-500 sm:text-sm transition-all" placeholder="Search title or content...">
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-2 space-y-1 bg-slate-50/30" id="prompt-list"></div>
      </section>
      
      <!-- Right Panel: Prompt Detail & Editor -->
      <main class="flex-1 overflow-y-auto bg-white flex flex-col" id="prompt-detail"></main>
    </div>
  `;

  setTimeout(() => {
    // 1. Render Market Tabs
    const tabsContainer = document.getElementById('market-tabs');
    state.markets.forEach(m => {
      const btn = document.createElement('button');
      const isSelected = state.selectedMarketId === m.id;
      btn.className = `px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${isSelected ? 'bg-brand-50 text-brand-700 shadow-sm border border-brand-200' : 'text-slate-500 border border-transparent hover:text-slate-900 hover:bg-slate-100'
        }`;
      btn.textContent = m.name;
      btn.onclick = async () => {
        state.selectedMarketId = m.id;
        state.selectedTopicId = null;
        state.selectedPromptId = null;
        await loadMarketData();
      };
      tabsContainer.appendChild(btn);
    });

    // 2. Render Topics
    const topicList = document.getElementById('topic-list');

    // "All Topics" option
    const allBtn = document.createElement('button');
    allBtn.className = `w-full text-left px-3 py-2 rounded-lg text-sm font-medium mb-1 flex items-center gap-2 transition-colors ${!state.selectedTopicId ? 'bg-white text-brand-600 shadow-sm border border-slate-200' : 'text-slate-600 hover:bg-slate-100'}`;
    allBtn.innerHTML = `<i data-lucide="folders" class="h-4 w-4 ${!state.selectedTopicId ? 'text-brand-500' : 'text-slate-400'}"></i> All Prompts`;
    allBtn.onclick = async () => { state.selectedTopicId = null; state.selectedPromptId = null; await loadPromptsData(); };
    topicList.appendChild(allBtn);

    state.topics.forEach(t => {
      const btn = document.createElement('button');
      const isSelected = state.selectedTopicId === t.id;
      btn.className = `w-full text-left px-3 py-2 rounded-lg text-sm mb-1 flex items-center justify-between group transition-colors ${isSelected ? 'bg-white text-brand-700 shadow-sm border border-slate-200 font-medium' : 'text-slate-600 hover:bg-slate-100 border border-transparent hover:border-slate-200'}`;
      btn.innerHTML = `
        <span class="truncate flex items-center gap-2">
          <i data-lucide="folder" class="h-4 w-4 ${isSelected ? 'text-brand-500' : 'text-slate-400 group-hover:text-brand-400 transition-colors'}"></i>
          ${escapeHtml(t.name)}
        </span>
      `;
      btn.onclick = async () => { state.selectedTopicId = t.id; state.selectedPromptId = null; await loadPromptsData(); };
      topicList.appendChild(btn);
    });

    // 3. Render Prompts
    const promptList = document.getElementById('prompt-list');
    if (state.prompts.length === 0) {
      promptList.innerHTML = `
        <div class="text-center py-10 px-4">
          <i data-lucide="search-x" class="h-8 w-8 mx-auto text-slate-300 mb-2"></i>
          <p class="text-sm text-slate-500">No prompts found</p>
        </div>
      `;
    } else {
      state.prompts.forEach(p => {
        const btn = document.createElement('div');
        const isSelected = state.selectedPromptId === p.id && !state.isEditingNew;
        btn.className = `w-full text-left p-3 rounded-lg border mb-2 cursor-pointer transition-all ${isSelected ? 'bg-brand-50 border-brand-200 shadow-sm ring-1 ring-brand-100' : 'bg-white border-slate-200 hover:border-brand-300 hover:shadow-sm'}`;

        // Find topic name
        const topicName = state.topics.find(t => t.id === p.topic_id)?.name || 'Unknown Topic';

        btn.innerHTML = `
          <div class="flex justify-between items-start mb-1">
            <h3 class="font-medium ${isSelected ? 'text-brand-900' : 'text-slate-900'} text-sm truncate pr-2">${escapeHtml(p.title)}</h3>
          </div>
          <p class="text-xs text-slate-500 truncate mb-2">${escapeHtml(p.content || '')}</p>
          <div class="flex items-center text-[10px] text-slate-400 font-medium uppercase tracking-wider">
            <span class="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">${escapeHtml(topicName)}</span>
          </div>
        `;
        btn.onclick = () => {
          state.selectedPromptId = p.id;
          state.isEditingNew = false;
          render();
        };
        promptList.appendChild(btn);
      });
    }

    // 4. Content Area (Prompt Detail or Empty)
    const detailEl = document.getElementById('prompt-detail');
    const canEdit = state.currentRole === 'edit' || state.currentRole === 'superadmin';

    if (state.isEditingNew) {
      detailEl.innerHTML = renderPromptEditor(null);
      attachEditorEvents(null);
    } else if (state.selectedPromptId) {
      const prompt = state.prompts.find(p => p.id === state.selectedPromptId);
      if (prompt) {
        detailEl.innerHTML = renderPromptView(prompt, canEdit);
        attachViewEvents(prompt);
      }
    } else {
      detailEl.innerHTML = `
        <div class="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/30">
          <div class="bg-white p-4 rounded-full shadow-sm border border-slate-100 mb-4">
            <i data-lucide="file-text" class="h-8 w-8 text-brand-300"></i>
          </div>
          <p class="text-slate-500 font-medium">Select a prompt to view details</p>
          ${canEdit ? `<p class="text-sm mt-2">or <button id="btn-create-prompt" class="text-brand-600 hover:underline">create a new prompt</button></p>` : ''}
        </div>
      `;
      document.getElementById('btn-create-prompt')?.addEventListener('click', () => {
        if (!state.selectedTopicId && state.topics.length > 0) {
          state.selectedTopicId = state.topics[0].id; // auto-select topic if none mapped
        }
        state.isEditingNew = true;
        render();
      });
    }

    // Header & Global Events
    document.getElementById('btn-logout')?.addEventListener('click', async () => await supabase.auth.signOut());
    document.getElementById('btn-admin')?.addEventListener('click', () => { state.view = 'admin'; render(); });

    const searchInput = document.getElementById('input-search');
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(async () => {
        state.searchQuery = e.target.value;
        await loadPromptsData();
      }, 300);
    });

    document.getElementById('btn-add-topic')?.addEventListener('click', async () => {
      const name = prompt("Enter new topic name:");
      if (name) {
        await supabase.from('topics').insert({ market_id: state.selectedMarketId, name });
        await loadMarketData();
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }, 0);

  return el;
}

// ---- Details and Forms ----

function renderPromptView(prompt, canEdit) {
  const topicName = state.topics.find(t => t.id === prompt.topic_id)?.name || '';
  const dateStr = new Date(prompt.updated_at).toLocaleString();

  return `
    <div class="flex-1 flex flex-col max-w-4xl mx-auto w-full p-6 sm:p-8 animate-fade-in">
      <div class="flex justify-between items-start mb-6">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-100 text-brand-800">
              ${escapeHtml(topicName)}
            </span>
            <span class="text-xs text-slate-400">Last updated: ${dateStr}</span>
          </div>
          <h1 class="text-2xl font-bold text-slate-900">${escapeHtml(prompt.title)}</h1>
        </div>
        
        <div class="flex gap-2">
          <button id="btn-copy" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600 shadow-sm transition-colors">
            <i data-lucide="copy" class="h-4 w-4"></i> Copy
          </button>
          ${canEdit ? `
            <button id="btn-edit-prompt" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600 shadow-sm transition-colors">
              <i data-lucide="edit-3" class="h-4 w-4"></i> Edit
            </button>
            <button id="btn-del-prompt" class="inline-flex items-center px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-red-500 hover:bg-red-50 hover:border-red-200 shadow-sm transition-colors" title="Delete">
              <i data-lucide="trash-2" class="h-4 w-4"></i>
            </button>
          ` : ''}
        </div>
      </div>
      
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-8 shadow-inner font-mono text-sm whitespace-pre-wrap text-slate-700 leading-relaxed overflow-x-auto relative group">
        ${escapeHtml(prompt.content || '')}
      </div>
      
      <!-- Version History Section -->
      <div class="mt-auto pt-8 border-t border-slate-100">
        <h3 class="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-4">
          <i data-lucide="history" class="h-4 w-4 text-slate-400"></i> Version History
        </h3>
        <div id="version-list" class="space-y-3">
          <div class="text-xs text-slate-400 animate-pulse">Loading history...</div>
        </div>
      </div>
    </div>
  `;
}

function attachViewEvents(prompt) {
  document.getElementById('btn-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(prompt.content);
    // show thin toast
    const el = document.getElementById('btn-copy');
    const origHtml = el.innerHTML;
    el.innerHTML = '<i data-lucide="check" class="h-4 w-4 text-green-500"></i> Copied!';
    if (window.lucide) window.lucide.createIcons();
    setTimeout(() => { el.innerHTML = origHtml; if (window.lucide) window.lucide.createIcons(); }, 2000);
  });

  document.getElementById('btn-edit-prompt')?.addEventListener('click', () => {
    state.isEditingNew = true; // reusing toggle for "edit mode"
    render();
  });

  document.getElementById('btn-del-prompt')?.addEventListener('click', async () => {
    if (confirm("Are you sure you want to delete this prompt?")) {
      await api.deletePrompt(prompt.id);
      state.selectedPromptId = null;
      await loadPromptsData();
    }
  });

  // Load versions
  api.getPromptVersions(prompt.id).then(versions => {
    const list = document.getElementById('version-list');
    if (!versions || versions.length === 0) {
      list.innerHTML = '<p class="text-xs text-slate-400 italic">No previous versions.</p>';
      return;
    }
    list.innerHTML = versions.map(v => `
      <div class="bg-white border border-slate-100 rounded-lg p-3 text-sm">
        <div class="flex justify-between text-xs text-slate-500 mb-2">
          <span class="font-medium text-slate-700">Version ${v.version}</span>
          <span>${new Date(v.date).toLocaleString()}</span>
        </div>
        <div class="text-xs font-mono text-slate-600 line-clamp-3 bg-slate-50 p-2 rounded border border-slate-100">
          ${escapeHtml(v.content || '')}
        </div>
      </div>
    `).join('');
  }).catch(e => {
    document.getElementById('version-list').innerHTML = '<p class="text-xs text-red-400">Failed to load versions.</p>';
  });
}

function renderPromptEditor() {
  const prompt = state.prompts.find(p => p.id === state.selectedPromptId) || { topic_id: state.selectedTopicId || '', title: '', content: '' };

  return `
    <div class="flex-1 flex flex-col max-w-3xl mx-auto w-full p-6 sm:p-8">
      <div class="mb-6 flex items-center gap-3">
        <button id="btn-cancel-edit" class="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors">
          <i data-lucide="arrow-left" class="h-5 w-5"></i>
        </button>
        <h1 class="text-xl font-bold text-slate-900">${prompt.id ? 'Edit Prompt' : 'Custom New Prompt'}</h1>
      </div>
      
      <form id="form-prompt" class="space-y-5">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Topic</label>
          <select id="input-topic" required class="block w-full border border-slate-300 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-brand-500 focus:border-brand-500 sm:text-sm bg-white">
            <option value="" disabled ${!prompt.topic_id ? 'selected' : ''}>Select a topic...</option>
            ${state.topics.map(t => `<option value="${t.id}" ${prompt.topic_id === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Title</label>
          <input type="text" id="input-title" required value="${escapeHtml(prompt.title)}" class="block w-full border border-slate-300 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-brand-500 focus:border-brand-500 sm:text-sm" placeholder="e.g. Sales Outreach Template">
        </div>
        
        <div class="flex-1 min-h-[300px] flex flex-col">
          <label class="block text-sm font-medium text-slate-700 mb-1">Content</label>
          <textarea id="input-content" required class="flex-1 block w-full border border-slate-300 rounded-lg shadow-sm py-3 px-3 focus:outline-none focus:ring-brand-500 focus:border-brand-500 sm:text-sm font-mono leading-relaxed" placeholder="Write your prompt content here...">${escapeHtml(prompt.content)}</textarea>
        </div>
        
        <div class="pt-4 flex justify-end gap-3 border-t border-slate-100">
          <button type="button" id="btn-cancel-edit-2" class="px-4 py-2 border border-slate-300 rounded-lg shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-colors">
            Cancel
          </button>
          <button type="submit" class="inline-flex items-center gap-2 px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-colors">
            <i data-lucide="save" class="h-4 w-4"></i> Save Prompt
          </button>
        </div>
      </form>
    </div>
  `;
}

function attachEditorEvents() {
  const exitEdit = () => {
    state.isEditingNew = false;
    render();
  };

  document.getElementById('btn-cancel-edit').addEventListener('click', exitEdit);
  document.getElementById('btn-cancel-edit-2').addEventListener('click', exitEdit);

  document.getElementById('form-prompt').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = e.target.querySelector('button[type="submit"]');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="h-4 w-4 animate-spin"></i> Saving...';
    if (window.lucide) window.lucide.createIcons();

    try {
      const data = {
        id: state.selectedPromptId,
        topic_id: document.getElementById('input-topic').value,
        title: document.getElementById('input-title').value,
        content: document.getElementById('input-content').value,
      };

      const newPrompt = await api.savePrompt(data);
      state.isEditingNew = false;
      state.selectedPromptId = newPrompt.id;
      await loadPromptsData();
    } catch (err) {
      alert("Error saving: " + err.message);
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i data-lucide="save" class="h-4 w-4"></i> Save Prompt';
      if (window.lucide) window.lucide.createIcons();
    }
  });
}

// ------------------------
// Admin Panel
// ------------------------
function renderAdminPanel() {
  const el = createElementFromHTML(`
    <div class="min-h-screen bg-slate-50 p-6 sm:p-10 fade-in w-full overflow-y-auto">
      <div class="max-w-5xl mx-auto w-full">
        <div class="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div class="flex items-center gap-4">
            <div class="bg-slate-900 p-2.5 rounded-xl text-white shadow-sm">
              <i data-lucide="shield" class="h-6 w-6"></i>
            </div>
            <div>
              <h1 class="text-2xl font-bold text-slate-900">Admin Console</h1>
              <p class="text-slate-500 text-sm mt-0.5">Manage markets and roles</p>
            </div>
          </div>
          <button id="btn-back-app" class="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 hover:text-brand-600 transition-colors">
            <i data-lucide="arrow-left" class="h-4 w-4"></i> Exit Admin
          </button>
        </div>
        
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <!-- Main Content: Roles mapping -->
          <div class="lg:col-span-2 space-y-6">
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h2 class="text-lg font-medium text-slate-800">Assign Roles</h2>
              </div>
              <div class="p-6">
                <!-- Simple Assign Form -->
                <form id="form-assign-role" class="flex gap-4 items-end flex-wrap">
                  <div class="flex-1 min-w-[200px]">
                     <label class="block text-xs font-medium text-slate-500 mb-1 uppercase tracking-wider">User</label>
                     <select id="sel-user" class="block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:ring-brand-500 focus:border-brand-500 sm:text-sm">
                     </select>
                  </div>
                  <div class="flex-1 min-w-[150px]">
                     <label class="block text-xs font-medium text-slate-500 mb-1 uppercase tracking-wider">Market</label>
                     <select id="sel-market" class="block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:ring-brand-500 focus:border-brand-500 sm:text-sm">
                     </select>
                  </div>
                  <div class="flex-1 min-w-[120px]">
                     <label class="block text-xs font-medium text-slate-500 mb-1 uppercase tracking-wider">Role</label>
                     <select id="sel-role" class="block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:ring-brand-500 focus:border-brand-500 sm:text-sm">
                       <option value="view">View</option>
                       <option value="edit">Edit</option>
                     </select>
                  </div>
                  <button type="submit" class="px-4 py-2 bg-brand-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-brand-700 focus:outline-none transition-colors h-[38px]">
                    Assign
                  </button>
                </form>
                
                <div class="mt-8 border-t border-slate-100 pt-6">
                  <h3 class="text-sm font-semibold text-slate-700 mb-4">Current Assignments</h3>
                  <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-slate-200">
                      <thead>
                        <tr>
                          <th class="px-4 py-3 bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider rounded-tl-lg rounded-bl-lg">User Email</th>
                          <th class="px-4 py-3 bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Market</th>
                          <th class="px-4 py-3 bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Role</th>
                          <th class="px-4 py-3 bg-slate-50 text-right text-xs font-medium text-slate-500 uppercase tracking-wider rounded-tr-lg rounded-br-lg">Actions</th>
                        </tr>
                      </thead>
                      <tbody id="roles-tbody" class="bg-white divide-y divide-slate-100">
                        <!-- Roles populated here -->
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h2 class="text-lg font-medium text-slate-800">All Users</h2>
              </div>
              <div class="p-6 overflow-x-auto">
                <table class="min-w-full divide-y divide-slate-200">
                  <tbody id="users-tbody" class="bg-white divide-y divide-slate-100">
                    <!-- Users populated here -->
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          
          <!-- Sidebar: Markets -->
          <div class="space-y-6">
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
               <div class="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                 <h2 class="text-md font-medium text-slate-800 flex items-center gap-2"><i data-lucide="globe" class="h-4 w-4 text-brand-500"></i> Markets</h2>
               </div>
               <div class="p-5">
                 <form id="form-add-market" class="flex gap-2 mb-4">
                   <input type="text" id="input-new-market" required placeholder="New market name..." class="flex-1 border border-slate-300 rounded-md py-1.5 px-3 text-sm focus:ring-brand-500 focus:border-brand-500">
                   <button type="submit" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md text-sm transition-colors border border-slate-200 shadow-sm">Add</button>
                 </form>
                 <ul id="market-list-admin" class="space-y-2"></ul>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  setTimeout(async () => {
    document.getElementById('btn-back-app').addEventListener('click', async () => {
      state.view = 'app';
      // Re-fetch roles/markets in case admin changed them for themselves
      await handleLogin(state.user);
    });

    await loadAdminDataInternal();
    if (window.lucide) window.lucide.createIcons();
  }, 0);

  return el;
}

async function loadAdminDataInternal() {
  const usersContainer = document.getElementById('users-tbody');
  const rolesContainer = document.getElementById('roles-tbody');
  const marketContainer = document.getElementById('market-list-admin');
  const selUser = document.getElementById('sel-user');
  const selMarket = document.getElementById('sel-market');

  try {
    const [users, markets, { data: roles }] = await Promise.all([
      api.getUsers(),
      api.getMarkets(),
      supabase.from('user_market_roles').select('*, users(email), markets(name)')
    ]);

    // Users Select
    selUser.innerHTML = users.map(u => `<option value="${u.id}">${escapeHtml(u.email)}</option>`).join('');
    // Markets Select
    selMarket.innerHTML = markets.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');

    // Roles Table
    rolesContainer.innerHTML = roles.length === 0 ? '<tr><td colspan="4" class="text-slate-400 text-center py-4 text-sm">No roles assigned.</td></tr>' : roles.map(r => `
      <tr>
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-slate-900">${escapeHtml(r.users?.email || 'Unknown')}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-slate-500">${escapeHtml(r.markets?.name || 'Unknown')}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-slate-500">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${r.role === 'edit' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}">
            ${r.role}
          </span>
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-right text-sm">
          <button class="text-red-500 hover:text-red-700 btn-del-role" data-id="${r.id}"><i data-lucide="x" class="h-4 w-4 ml-auto"></i></button>
        </td>
      </tr>
    `).join('');

    // Markets Sidebar
    marketContainer.innerHTML = markets.map(m => `
      <li class="flex justify-between items-center text-sm py-2 px-3 rounded text-slate-700 bg-slate-50 border border-slate-100">
        <span class="font-medium">${escapeHtml(m.name)}</span>
      </li>
    `).join('');

    // Users List
    usersContainer.innerHTML = users.map(u => `
      <tr>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-slate-900 font-medium">${escapeHtml(u.email)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm">
           ${u.is_super_admin ? '<span class="inline-flex px-2 py-0.5 rounded text-xs tracking-wider font-semibold bg-purple-100 text-purple-800 border border-purple-200 uppercase">Super Admin</span>' : '<span class="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">User</span>'}
        </td>
        <td class="px-4 py-3 text-right">
           ${!u.is_super_admin ? `<button class="btn-make-admin text-xs text-brand-600 hover:underline" data-id="${u.id}">Make Super Admin</button>` : ''}
        </td>
      </tr>
    `).join('');

    // Events
    document.querySelectorAll('.btn-del-role').forEach(btn => {
      btn.onclick = async () => {
        if (confirm('Remove this role?')) {
          await supabase.from('user_market_roles').delete().eq('id', btn.dataset.id);
          loadAdminDataInternal();
        }
      };
    });

    document.querySelectorAll('.btn-make-admin').forEach(btn => {
      btn.onclick = async () => {
        if (confirm('Make user super admin?')) {
          await supabase.from('users').update({ is_super_admin: true }).eq('id', btn.dataset.id);
          loadAdminDataInternal();
        }
      };
    });

  } catch (err) {
    console.error(err);
    alert('Error loading admin data: ' + err.message);
  }
}

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'form-assign-role') {
    e.preventDefault();
    const user_id = document.getElementById('sel-user').value;
    const market_id = document.getElementById('sel-market').value;
    const role = document.getElementById('sel-role').value;

    const { error } = await supabase.from('user_market_roles').upsert({
      user_id, market_id, role
    }, { onConflict: 'user_id,market_id' });

    if (error) alert(error.message);
    else loadAdminDataInternal();
  }

  if (e.target.id === 'form-add-market') {
    e.preventDefault();
    const name = document.getElementById('input-new-market').value;
    const { error } = await supabase.from('markets').insert({ name });
    if (error) alert(error.message);
    else {
      document.getElementById('input-new-market').value = '';
      loadAdminDataInternal();
    }
  }
});

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Start app
init();
