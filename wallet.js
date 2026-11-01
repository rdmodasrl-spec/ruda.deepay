(() => {
  const apiBase = String(window.DEEPAY_WALLET_API_BASE || '/api').replace(/\/$/, '');
  const path = window.location.pathname;
  const isAuthPage = path.endsWith('/wallet-login.html');
  const state = {
    accounts: [],
    transactions: [],
    authenticated: false,
    transferAttempt: null,
  };

  class WalletRequestError extends Error {
    constructor(message, status = 0) {
      super(message);
      this.name = 'WalletRequestError';
      this.status = status;
    }
  }

  async function request(endpoint, method = 'GET', body) {
    const url = new URL(`${apiBase}${endpoint}`, window.location.origin);
    const options = {
      method,
      credentials: url.origin === window.location.origin ? 'same-origin' : 'include',
      cache: 'no-store',
      headers: {},
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(url, options);
    } catch {
      throw new WalletRequestError('无法连接钱包 API。请检查同源反向代理和服务状态。');
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new WalletRequestError(
        response.ok ? '钱包 API 返回了无效响应。' : `钱包 API 请求失败（HTTP ${response.status}）。`,
        response.status,
      );
    }
    if (!response.ok) {
      throw new WalletRequestError(result?.message || `钱包 API 请求失败（HTTP ${response.status}）。`, response.status);
    }
    if (typeof result?.code === 'number' && result.code !== 0) {
      throw new WalletRequestError(result.message || '钱包 API 返回业务错误。', response.status);
    }
    if (!Object.hasOwn(result ?? {}, 'data')) {
      throw new WalletRequestError('钱包 API 响应缺少数据字段。', response.status);
    }
    return result.data;
  }

  function showMessage(message) {
    document.querySelector('.wallet-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'wallet-toast';
    toast.setAttribute('role', 'alert');
    toast.textContent = message;
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 5000);
  }

  function setStatus(message) {
    document.querySelectorAll('.wallet-status').forEach((element) => {
      element.textContent = message;
    });
  }

  function showBanner(message, withLogin = false) {
    const main = document.querySelector('main');
    if (!main) return;
    document.querySelector('.wallet-notice')?.remove();
    const notice = document.createElement('aside');
    notice.className = 'wallet-notice';
    notice.setAttribute('role', 'status');
    const strong = document.createElement('strong');
    strong.textContent = state.authenticated ? 'TEST 环境' : '钱包未连接';
    const copy = document.createElement('span');
    copy.textContent = message;
    notice.append(strong, copy);
    if (withLogin) {
      const link = document.createElement('a');
      link.href = '/wallet-login.html';
      link.textContent = '登录';
      notice.append(link);
    }
    main.prepend(notice);
  }

  function createLink(href, label, activePath) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (href === activePath || (activePath === '/index.html' && href === '/')) {
      link.setAttribute('aria-current', 'page');
    }
    return link;
  }

  function setupNavigation() {
    if (isAuthPage) return;
    const shell = document.querySelector('.app-shell, .shell');
    const topbar = shell?.querySelector(':scope > .topbar');
    const main = shell?.querySelector(':scope > main');
    if (!shell || !topbar || !main) return;

    const sidebar = document.createElement('aside');
    sidebar.className = 'wallet-sidebar';
    const brand = document.createElement('div');
    brand.className = 'wallet-sidebar-brand';
    const logo = document.createElement('img');
    logo.src = '/logo.png';
    logo.alt = '';
    const name = document.createElement('span');
    name.textContent = 'DEEPAY';
    brand.append(logo, name);

    const nav = document.createElement('nav');
    nav.className = 'wallet-sidebar-nav';
    nav.setAttribute('aria-label', '钱包导航');
    [
      ['/', '钱包首页'],
      ['/wallet-asset.html', '资产'],
      ['/wallet-transactions.html', '交易记录'],
      ['/recharge.html', '充值'],
      ['/withdraw.html', '提现'],
      ['/transfer.html', '转账'],
      ['/receive.html', '收款'],
    ].forEach(([href, label]) => nav.append(createLink(href, label, path)));

    const footer = document.createElement('div');
    footer.className = 'wallet-sidebar-footer';
    footer.textContent = '邀请制测试钱包 · 仅显示服务端 TEST 账本';
    const logout = createLink('#logout', '退出登录', '');
    logout.dataset.walletAction = 'logout';
    logout.hidden = true;
    logout.style.display = 'none';
    footer.append(logout);
    sidebar.append(brand, nav, footer);

    const workspace = document.createElement('div');
    workspace.className = 'wallet-workspace';
    workspace.append(topbar, main);
    shell.replaceChildren(sidebar, workspace);

    const mobileNav = document.createElement('nav');
    mobileNav.className = 'wallet-bottom-nav';
    mobileNav.setAttribute('aria-label', '钱包快捷导航');
    [
      ['/', '首页'],
      ['/wallet-asset.html', '资产'],
      ['/wallet-transactions.html', '交易'],
      ['/receive.html', '收款'],
    ].forEach(([href, label]) => mobileNav.append(createLink(href, label, path)));
    document.body.append(mobileNav);
  }

  function groupDecimal(value) {
    const [whole, fraction] = String(value).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction ? `${grouped}.${fraction}` : grouped;
  }

  function formatUnits(units, precision) {
    if (precision === null || precision === undefined) {
      return `${units} units（未配置精度）`;
    }
    const value = BigInt(units);
    const negative = value < 0n;
    const digits = (negative ? -value : value).toString().padStart(precision + 1, '0');
    if (precision === 0) return `${negative ? '-' : ''}${groupDecimal(digits)}`;
    const whole = digits.slice(0, -precision);
    const fraction = digits.slice(-precision).replace(/0+$/, '');
    return `${negative ? '-' : ''}${groupDecimal(whole)}${fraction ? `.${fraction}` : ''}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间不可用';
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function makeEmptyRow(columns, message) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columns;
    cell.className = 'wallet-empty';
    cell.textContent = message;
    row.append(cell);
    return row;
  }

  function renderHome() {
    const eur = state.accounts.find((account) => account.assetCode === 'EUR' && account.enabled);
    const total = document.querySelector('#totalAmount');
    const toggle = document.querySelector('#toggleBalance');
    if (total) {
      total.textContent = eur ? groupDecimal(formatUnits(eur.availableUnits, eur.precision)) : '—';
      total.dataset.value = total.textContent;
    }
    if (toggle) {
      toggle.disabled = !eur;
      toggle.textContent = eur ? '隐藏金额' : '余额不可用';
      toggle.onclick = () => {
        const hidden = toggle.dataset.hidden === 'true';
        toggle.dataset.hidden = String(!hidden);
        total.textContent = hidden ? total.dataset.value : '••••••';
        toggle.textContent = hidden ? '隐藏金额' : '显示金额';
      };
    }
    const meta = document.querySelector('.hero .meta');
    if (meta) {
      meta.textContent = eur
        ? 'TEST 环境 EUR 可用余额，按服务端账本展示；未接入汇率或资产估值。'
        : '没有可显示的 EUR 测试账户。其他资产估值未接入。';
    }

    const assetGrid = document.querySelector('[data-wallet-assets]');
    if (assetGrid) {
      assetGrid.replaceChildren();
      state.accounts.forEach((account) => {
        const card = document.createElement('article');
        card.className = 'asset-card';
        const header = document.createElement('div');
        header.className = 'asset-header';
        const assetName = document.createElement('div');
        assetName.className = 'asset-name';
        const dot = document.createElement('span');
        dot.className = 'asset-dot';
        const code = document.createElement('span');
        code.textContent = account.assetCode;
        assetName.append(dot, code);
        const badge = document.createElement('span');
        badge.className = `badge ${account.enabled ? 'ok' : 'info'}`;
        badge.textContent = account.enabled ? `${account.environment} · 已启用` : '未配置 / 未启用';
        header.append(assetName, badge);
        const balance = document.createElement('div');
        balance.className = 'asset-balance';
        balance.textContent = groupDecimal(formatUnits(account.availableUnits, account.precision));
        const network = document.createElement('div');
        network.className = 'asset-change';
        network.textContent = account.network || (account.enabled ? '内部账本资产' : '网络尚未配置');
        card.append(header, balance, network);
        if (account.enabled) {
          const link = document.createElement('a');
          link.href = `/wallet-asset.html?asset=${encodeURIComponent(account.assetCode)}`;
          link.className = 'link';
          link.textContent = '查看账户明细';
          card.append(link);
        }
        assetGrid.append(card);
      });
      if (state.accounts.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'wallet-empty';
        empty.textContent = '服务端尚未为此用户创建钱包账户。';
        assetGrid.append(empty);
      }
    }

    const list = document.querySelector('.tx-list');
    if (list) {
      list.replaceChildren(...state.transactions.slice(0, 5).map((transaction) => {
        const item = document.createElement('li');
        item.className = 'tx-item';
        const icon = document.createElement('div');
        icon.className = `tx-icon ${transaction.direction === 'CREDIT' ? 'in' : 'out'}`;
        icon.textContent = transaction.direction === 'CREDIT' ? '↑' : '↓';
        const details = document.createElement('div');
        const type = document.createElement('div');
        type.className = 'tx-type';
        type.textContent = transaction.transactionType === 'TEST_CREDIT'
          ? 'EUR 测试入账'
          : transaction.direction === 'CREDIT' ? '内部转入' : '内部转出';
        const sub = document.createElement('div');
        sub.className = 'tx-sub';
        sub.textContent = `${formatDate(transaction.createdAt)} · ${transaction.assetCode} · 流水 ${transaction.transactionId}`;
        details.append(type, sub);
        const amount = document.createElement('div');
        amount.className = `tx-amount ${transaction.direction === 'CREDIT' ? 'green' : 'red'}`;
        amount.textContent = `${transaction.direction === 'CREDIT' ? '+' : '-'}${transaction.assetCode} ${transaction.amount}`;
        item.append(icon, details, amount);
        return item;
      }));
      if (state.transactions.length === 0) {
        list.append(makeEmptyRow(1, '账本暂无交易记录。'));
      }
    }
  }

  function renderTransactions() {
    const body = document.querySelector('.table tbody');
    if (!body || !path.endsWith('/wallet-transactions.html')) return;
    const filters = document.querySelectorAll('.filters select');
    const search = document.querySelector('.filters input');
    const selectedType = filters[0]?.value || '';
    const selectedAsset = filters[1]?.value || '';
    const query = search?.value.trim().toLowerCase() || '';
    const transactions = state.transactions.filter((transaction) =>
      (!selectedType || transaction.transactionType === selectedType)
      && (!selectedAsset || transaction.assetCode === selectedAsset)
      && (!query || String(transaction.transactionId).toLowerCase().includes(query)));

    body.replaceChildren(...transactions.map((transaction) => {
      const row = document.createElement('tr');
      const direction = transaction.direction === 'CREDIT' ? '转入' : '转出';
      const values = [
        transaction.transactionType === 'TEST_CREDIT'
          ? '模拟测试入账'
          : `内部${direction}`,
        `${transaction.assetCode} / TEST`,
        `${transaction.direction === 'CREDIT' ? '+' : '-'}${transaction.amount}`,
        '已写入测试账本',
        formatDate(transaction.createdAt),
      ];
      values.forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      const idCell = document.createElement('td');
      const link = document.createElement('a');
      link.href = `/transaction-detail.html?id=${encodeURIComponent(transaction.transactionId)}`;
      link.textContent = String(transaction.transactionId);
      idCell.append(link);
      row.append(idCell);
      return row;
    }));
    if (transactions.length === 0) {
      body.append(makeEmptyRow(6, state.transactions.length ? '没有符合筛选条件的交易。' : '账本暂无交易记录。'));
    }
  }

  function renderWalletAsset() {
    if (!path.endsWith('/wallet-asset.html')) return;
    const requestedCode = new URLSearchParams(window.location.search).get('asset');
    const account = state.accounts.find((item) => item.assetCode === requestedCode && item.enabled)
      || state.accounts.find((item) => item.assetCode === 'EUR' && item.enabled);
    const text = (selector, value) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    };
    if (!account) {
      text('[data-asset-code]', '无已启用资产');
      text('[data-asset-balance]', '—');
      text('[data-asset-available]', '当前没有启用的测试资产');
      return;
    }
    text('[data-asset-code]', account.assetCode);
    text('[data-asset-network]', account.network || '内部 TEST 账本');
    text('[data-asset-balance]', groupDecimal(formatUnits(account.availableUnits, account.precision)));
    text('[data-asset-available]', '可用余额 · 未做法币估值');
    text('[data-asset-environment]', `环境：${account.environment}。链上地址、行情和网络状态未接入。`);
    text('[data-account-balance="available"]', groupDecimal(formatUnits(account.availableUnits, account.precision)));
    text('[data-account-balance="pending"]', groupDecimal(formatUnits(account.pendingUnits, account.precision)));
    text('[data-account-balance="frozen"]', groupDecimal(formatUnits(account.frozenUnits, account.precision)));
    text('[data-account-balance="reserved"]', groupDecimal(formatUnits(account.reservedUnits, account.precision)));
    text('[data-wallet-id]', account.walletId);

    const body = document.querySelector('.table tbody');
    if (body) {
      const transactions = state.transactions.filter((item) => item.assetCode === account.assetCode);
      body.replaceChildren(...transactions.map((item) => {
        const row = document.createElement('tr');
        [
          item.direction === 'CREDIT' ? '内部转入' : '内部转出',
          `${item.direction === 'CREDIT' ? '+' : '-'}${item.amount}`,
          '已写入测试账本',
          formatDate(item.createdAt),
        ].forEach((value) => {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        });
        return row;
      }));
      if (transactions.length === 0) body.append(makeEmptyRow(4, '此资产暂无交易记录。'));
    }
  }

  function renderTransactionDetail() {
    if (!path.endsWith('/transaction-detail.html')) return;
    const id = new URLSearchParams(window.location.search).get('id');
    const transaction = state.transactions.find((item) => String(item.transactionId) === id);
    if (!transaction) {
      showBanner(id ? '未在最近 100 条账本记录中找到此交易。' : '请从交易列表选择一条交易查看详情。');
      return;
    }
    document.querySelector('.wallet-notice')?.remove();
    const inbound = transaction.direction === 'CREDIT';
    const signedAmount = `${inbound ? '+' : '-'}${transaction.assetCode} ${transaction.amount}`;
    document.querySelector('[data-transaction-amount]').textContent = signedAmount;
    document.querySelector('[data-transaction-direction]').textContent = transaction.transactionType === 'TEST_CREDIT'
      ? '模拟测试入账'
      : inbound ? '内部转入' : '内部转出';
    document.querySelector('[data-transaction-status]').textContent = '测试账本已记账（非真实资金）';
    document.querySelector('[data-transaction-ledger-status]').textContent = '已记入 TEST 账本';
    document.querySelector('[data-transaction-id]').textContent = `交易编号：${transaction.transactionId}`;
    document.querySelector('[data-transaction-type]').textContent = transaction.transactionType === 'TEST_CREDIT'
      ? '管理员测试入账'
      : inbound ? '内部转账（收款）' : '内部转账（付款）';
    document.querySelector('[data-transaction-scope]').textContent = transaction.transactionType === 'TEST_CREDIT'
      ? '模拟 EUR 测试额度（非真实资金）'
      : '用户内部 TEST 钱包转账';
    document.querySelector('[data-transaction-asset]').textContent = `${transaction.assetCode} · ${transaction.amount}`;
    document.querySelector('[data-transaction-time]').textContent = formatDate(transaction.createdAt);
    document.querySelector('[data-counterparty-wallet]').textContent = transaction.recipientWalletId || '未提供';
    const receiptButton = document.querySelector('[data-wallet-action="share-receipt"]');
    if (receiptButton) receiptButton.disabled = false;
    if (receiptButton) receiptButton.onclick = async () => {
      try {
        await navigator.clipboard.writeText(String(transaction.transactionId));
        showMessage('交易编号已复制。');
      } catch {
        showMessage('无法访问剪贴板，请手动记录交易编号。');
      }
    };
  }

  function setupTransferForm() {
    if (!path.endsWith('/transfer.html')) return;
    const select = document.querySelector('#asset');
    const button = document.querySelector('#submitTransfer');
    const recipient = document.querySelector('#recipient');
    const amount = document.querySelector('#amount');
    const enabledAccounts = state.accounts.filter((account) => account.enabled);
    if (select) {
      select.replaceChildren(...enabledAccounts.map((account) =>
        new Option(`${account.assetCode} · TEST`, account.assetCode)));
      select.disabled = enabledAccounts.length === 0;
    }
    if (recipient) recipient.disabled = enabledAccounts.length === 0;
    if (amount) amount.disabled = enabledAccounts.length === 0;
    if (!button) return;
    button.disabled = !state.authenticated || enabledAccounts.length === 0;
    button.textContent = button.disabled ? '没有可用 TEST 资产' : '确认转账';
    if (button.disabled) return;

    button.onclick = async () => {
      const recipientWalletId = recipient.value.trim();
      const amountValue = amount.value.trim();
      const assetCode = select.value;
      const asset = enabledAccounts.find((item) => item.assetCode === assetCode);
      const precision = asset?.precision ?? 0;
      const decimalPattern = precision === 0
        ? /^\d+$/
        : new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`);
      if (!recipientWalletId || !amountValue || !decimalPattern.test(amountValue)) {
        showMessage(`请填写有效钱包 ID 和金额（最多 ${precision} 位小数）。`);
        return;
      }
      const signature = JSON.stringify([recipientWalletId, assetCode, amountValue]);
      if (state.transferAttempt?.signature !== signature) {
        state.transferAttempt = { signature, key: crypto.randomUUID() };
      }
      if (!window.confirm(`确认从 TEST ${assetCode} 账户转出 ${amountValue}？提交后将由服务端原子记账。`)) return;
      button.disabled = true;
      button.textContent = '正在提交…';
      try {
        const transfer = await request('/wallet-api/transfers', 'POST', {
          recipientWalletId,
          assetCode,
          amount: amountValue,
          idempotencyKey: state.transferAttempt.key,
        });
        state.transferAttempt = null;
        showMessage(`转账已记录，账本流水 ${transfer.transactionId}。`);
        amount.value = '';
        await refreshWalletData();
      } catch (error) {
        showMessage(error.message || '转账失败。');
        if (error.status === 401) window.location.assign('/wallet-login.html');
      } finally {
        button.disabled = false;
        button.textContent = '确认转账';
      }
    };
  }

  function setupTransactionsPage() {
    if (!path.endsWith('/wallet-transactions.html')) return;
    const selects = document.querySelectorAll('.filters select');
    const typeSelect = selects[0];
    const assetSelect = selects[1];
    if (typeSelect) {
      typeSelect.replaceChildren(
        new Option('全部类型', ''),
        new Option('内部转账', 'INTERNAL_TRANSFER'),
        new Option('模拟测试入账', 'TEST_CREDIT'),
      );
    }
    if (assetSelect) {
      assetSelect.replaceChildren(
        new Option('全部资产', ''),
        ...[...new Set(state.accounts.map((account) => account.assetCode))]
          .map((code) => new Option(code, code)),
      );
    }
    selects.forEach((select) => { select.disabled = false; });
    const search = document.querySelector('.filters input');
    if (search) search.disabled = false;
    const filterContainer = document.querySelector('.filters');
    if (filterContainer && filterContainer.dataset.bound !== 'true') {
      filterContainer.dataset.bound = 'true';
      filterContainer.addEventListener('input', renderTransactions);
      filterContainer.addEventListener('change', renderTransactions);
    }
    renderTransactions();
  }

  function setUnsupportedActions() {
    const unsupported = new Set(['create-deposit', 'submit-withdrawal']);
    document.querySelectorAll('[data-wallet-action]').forEach((control) => {
      const action = control.dataset.walletAction;
      if (unsupported.has(action)) {
        control.disabled = true;
        control.title = '此功能尚未开发，不会创建申请或改变余额。';
      }
    });
    if (path.endsWith('/recharge.html')) {
      document.querySelectorAll('#asset, #network').forEach((element) => { element.disabled = true; });
      showBanner('充值申请、支付确认、链上监测和账本入账闭环尚未实现；本页面不会创建充值订单。');
    }
    if (path.endsWith('/withdraw.html')) {
      document.querySelectorAll('#asset, #address, #amount').forEach((element) => { element.disabled = true; });
      showBanner('提现审核、冻结、出款和账本扣款闭环尚未实现；本页面不会提交提现。');
    }
    if (path.endsWith('/wallet-status.html')) {
      showBanner('本阶段尚无充值或提现订单状态接口，因此无法查询资金操作进度。');
    }
  }

  async function refreshWalletData() {
    const accounts = await request('/wallet-api/accounts');
    state.accounts = Array.isArray(accounts) ? accounts : [];
    state.authenticated = true;
    setStatus('TEST 钱包已连接');
    renderHome();
    renderWalletAsset();
    setupTransferForm();
    setupTransactionsPage();
    const receiveId = document.querySelector('[data-wallet-id]');
    if (receiveId && !path.endsWith('/wallet-asset.html')) {
      receiveId.textContent = state.accounts[0]?.walletId || '暂无钱包 ID';
    }
    const copyButton = document.querySelector('[data-wallet-action="copy-address"]');
    if (copyButton) copyButton.disabled = !state.accounts[0]?.walletId;
    const logoutLink = document.querySelector('[data-wallet-action="logout"]');
    if (logoutLink) {
      logoutLink.hidden = false;
      logoutLink.style.display = 'inline-block';
    }
    const profileLink = document.querySelector('.topbar .avatar');
    if (profileLink) {
      profileLink.href = '#logout';
      profileLink.dataset.walletAction = 'logout';
      profileLink.textContent = '退出';
    }

    try {
      const transactions = await request('/wallet-api/transactions?limit=100');
      state.transactions = Array.isArray(transactions) ? transactions : [];
      renderHome();
      renderTransactions();
      renderWalletAsset();
      renderTransactionDetail();
    } catch (error) {
      showBanner(`资产已从服务端加载，但账本交易列表不可用：${error.message}`);
    }
  }

  function setupAuthPage() {
    const loginForm = document.querySelector('#walletLoginForm');
    const registerForm = document.querySelector('#walletRegisterForm');
    const feedback = document.querySelector('#walletAuthFeedback');
    document.querySelectorAll('[data-auth-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const loginMode = button.dataset.authMode === 'login';
        loginForm.hidden = !loginMode;
        registerForm.hidden = loginMode;
        document.querySelectorAll('[data-auth-mode]').forEach((item) => {
          item.classList.toggle('primary', item === button);
        });
      });
    });

    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const submit = loginForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      feedback.textContent = '';
      try {
        await request('/wallet-api/auth/login', 'POST', {
          email: formData.get('email'),
          password: formData.get('password'),
        });
        window.location.assign('/');
      } catch (error) {
        feedback.textContent = error.message || '登录失败。';
      } finally {
        submit.disabled = false;
      }
    });

    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(registerForm);
      const submit = registerForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      feedback.textContent = '';
      try {
        await request('/wallet-api/auth/register', 'POST', {
          email: formData.get('email'),
          password: formData.get('password'),
          inviteCode: formData.get('inviteCode'),
        });
        loginForm.elements.email.value = formData.get('email');
        registerForm.reset();
        loginForm.hidden = false;
        registerForm.hidden = true;
        feedback.textContent = '测试钱包已创建，请使用该邮箱登录。';
      } catch (error) {
        feedback.textContent = error.message || '注册失败。';
      } finally {
        submit.disabled = false;
      }
    });
  }

  setupNavigation();
  if (isAuthPage) {
    setupAuthPage();
    return;
  }

  document.querySelector('[data-wallet-action="copy-address"]')?.addEventListener('click', async () => {
    const walletId = state.accounts[0]?.walletId;
    if (!walletId) return showMessage('尚无可复制的钱包 ID。');
    try {
      await navigator.clipboard.writeText(walletId);
      showMessage('内部钱包 ID 已复制。此 ID 不是链上地址。');
    } catch {
      showMessage('无法访问剪贴板，请手动复制页面中的钱包 ID。');
    }
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-wallet-action="logout"]');
    if (!button) return;
    event.preventDefault();
    try {
      await request('/wallet-api/auth/logout', 'POST');
    } catch (error) {
      showMessage(`登出请求未完成：${error.message}`);
      return;
    }
    window.location.assign('/wallet-login.html');
  });

  setUnsupportedActions();
  setStatus('正在连接钱包 API…');
  refreshWalletData().catch((error) => {
    state.authenticated = false;
    setStatus(error.status === 401 ? '需要登录' : '钱包 API 不可用');
    showBanner(`${error.message} 未展示余额，也未提交任何资金操作。`, true);
    document.querySelectorAll('#submitTransfer').forEach((button) => { button.disabled = true; });
    document.querySelectorAll('[data-wallet-action="copy-address"]').forEach((button) => { button.disabled = true; });
    document.querySelectorAll('[data-wallet-action="share-receipt"]').forEach((button) => { button.disabled = true; });
    if (path.endsWith('/wallet-asset.html')) {
      document.querySelector('[data-asset-balance]').textContent = '—';
      document.querySelector('[data-asset-available]').textContent = '登录并连接 API 后显示';
      document.querySelector('[data-wallet-id]').textContent = '登录后显示内部钱包 ID';
    }
    if (path.endsWith('/wallet-transactions.html')) {
      const body = document.querySelector('.table tbody');
      if (body) body.replaceChildren(makeEmptyRow(6, '登录并连接钱包 API 后显示账本交易。'));
    }
    if (path.endsWith('/transaction-detail.html')) {
      document.querySelector('[data-transaction-id]').textContent = '交易编号：未加载';
    }
  });
})();
