// ==UserScript==
// @name         [银河奶牛]炼金利润计算器
// @name:zh-CN   [银河奶牛]炼金利润计算器
// @name:en      MWI-Alchemy Profit Calculator
// @namespace    http://tampermonkey.net/
// @version      0.9.0
// @description  炼金利润计算器，显示悲观和乐观日利润 / Alchemy profit calculator showing pessimistic and optimistic daily profits
// @author       XIxixi297
// @license      CC-BY-NC-SA-4.0
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=milkywayidle.com
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // 国际化文本配置
    const i18n = {
        zh: {
            pessimisticProfit: '悲观日利润',
            optimisticProfit: '乐观日利润',
            calculating: '计算中...',
            noData: '缺少市场数据',
            error: '错误',
            waitingAPI: '请确保已安装 [银河奶牛]自动计算购买材料...',
            loadSuccess: '[[银河奶牛]炼金利润计算器] 加载并初始化成功',
            loadFailed: '[[银河奶牛]炼金利润计算器] 加载失败，请确保已安装 [银河奶牛]自动计算购买材料',
            apiCheckAttempt: '[[银河奶牛]炼金利润计算器] 正在检查 AutoBuyAPI，尝试次数：',
            apiTimeout: '[[银河奶牛]炼金利润计算器] 等待 AutoBuyAPI 超时'
        },
        en: {
            pessimisticProfit: 'Pessimistic Daily Profit',
            optimisticProfit: 'Optimistic Daily Profit',
            calculating: 'Calculating...',
            noData: 'Lack of Market Data',
            error: 'Error',
            waitingAPI: 'Please Make Sure Install MWI-AutoBuyer...',
            loadSuccess: '[MWI-Alchemy Profit Calculator] loaded and initialized successfully',
            loadFailed: '[MWI-Alchemy Profit Calculator] Failed to load, please make sure install MWI-AutoBuyer',
            apiCheckAttempt: '[MWI-Alchemy Profit Calculator] Checking AutoBuyAPI, attempt:',
            apiTimeout: '[MWI-Alchemy Profit Calculator] Waiting for AutoBuyAPI timeout'
        }
    };

    // 根据浏览器语言选择对应的文本
    const t = i18n[(navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'];
    
    // 缓存过期时间（5分钟）
    const CACHE_EXPIRY = 3e5;
    
    // 全局变量
    const marketData = {}, marketTimestamps = {};
    let requestQueue = [], isProcessing = false, lastState = '', updateTimeout = null, apiReady = false;

    /**
     * 检查缓存是否过期
     * @param {string} item - 物品标识符
     * @returns {boolean} 是否过期
     */
    const isCacheExpired = (item) => !marketTimestamps[item] || Date.now() - marketTimestamps[item] > CACHE_EXPIRY;
    
    /**
     * 清理过期的缓存数据
     * 定期清理已过期的市场数据缓存
     */
    const cleanCache = () => {
        const now = Date.now();
        Object.keys(marketTimestamps).forEach(item => {
            if (now - marketTimestamps[item] > CACHE_EXPIRY) {
                delete marketData[item];
                delete marketTimestamps[item];
            }
        });
    };
    // 每分钟执行一次缓存清理
    setInterval(cleanCache, 6e4);

    /**
     * 检查 AutoBuyAPI 是否可用
     * @returns {boolean} API是否可用
     */
    const checkAPI = () => typeof AutoBuyAPI !== 'undefined' && 
        AutoBuyAPI.core?.handleGetMarketItemOrderBooks && 
        AutoBuyAPI.hookMessage;

    /**
     * 初始化API钩子，监听市场数据更新
     * @returns {boolean} 初始化是否成功
     */
    const initHook = () => {
        if (!checkAPI()) return false;
        try {
            // 监听市场订单簿更新事件
            AutoBuyAPI.hookMessage("market_item_order_books_updated", obj => {
                const { itemHrid, orderBooks } = obj.marketItemOrderBooks;
                marketData[itemHrid] = orderBooks;
                marketTimestamps[itemHrid] = Date.now();
            });
            return true;
        } catch { return false; }
    };

    /**
     * 处理市场数据请求队列
     * 批量处理请求，避免过于频繁的API调用
     */
    const processQueue = async () => {
        if (isProcessing || !requestQueue.length || !apiReady) return;
        isProcessing = true;

        while (requestQueue.length > 0) {
            // 每次处理6个请求
            const batch = requestQueue.splice(0, 6);
            await Promise.all(batch.map(async ({ itemHrid, resolve }) => {
                // 检查缓存中是否有有效数据
                if (marketData[itemHrid] && !isCacheExpired(itemHrid)) {
                    return resolve(marketData[itemHrid]);
                }
                
                // 清理过期缓存
                if (isCacheExpired(itemHrid)) {
                    delete marketData[itemHrid];
                    delete marketTimestamps[itemHrid];
                }
                
                // 请求新数据
                try { AutoBuyAPI.core.handleGetMarketItemOrderBooks(itemHrid); } catch {}
                
                // 等待数据返回，最多等待5秒
                const start = Date.now();
                await new Promise(waitResolve => {
                    const check = setInterval(() => {
                        if (marketData[itemHrid] || Date.now() - start > 5e3) {
                            clearInterval(check);
                            resolve(marketData[itemHrid] || null);
                            waitResolve();
                        }
                    }, 50);
                });
            }));
            // 批次间隔100ms，避免请求过于密集
            if (requestQueue.length > 0) await new Promise(r => setTimeout(r, 100));
        }
        isProcessing = false;
    };

    /**
     * 获取物品的市场数据
     * @param {string} itemHrid - 物品标识符
     * @returns {Promise<Object|null>} 市场订单簿数据
     */
    const getMarketData = (itemHrid) => new Promise(resolve => {
        // 优先使用缓存数据
        if (marketData[itemHrid] && !isCacheExpired(itemHrid)) return resolve(marketData[itemHrid]);
        if (!apiReady) return resolve(null);
        // 加入请求队列
        requestQueue.push({ itemHrid, resolve });
        processQueue();
    });

    /**
     * 获取React组件的props
     * @param {Element} el - DOM元素
     * @returns {Object|null} React props对象
     */
    const getReactProps = el => {
        const key = Object.keys(el || {}).find(k => k.startsWith('__reactProps$'));
        return key ? el[key]?.children[0]?._owner?.memoizedProps : null;
    };

    /**
     * 获取物品数据（价格、数量等）
     * @param {Element} el - 物品DOM元素
     * @param {number} dropIndex - 掉落物品索引（-1表示非掉落物品）
     * @param {number} reqIndex - 材料索引（-1表示非材料）
     * @returns {Promise<Object|null>} 物品数据对象
     */
    const getItemData = async (el, dropIndex = -1, reqIndex = -1) => {
        // 从SVG图标获取物品标识符
        const href = el?.querySelector('svg use')?.getAttribute('href');
        const itemHrid = href ? `/items/${href.split('#')[1]}` : null;
        if (!itemHrid) return null;

        // 获取强化等级（仅对材料有效）
        let enhancementLevel = 0;
        if (reqIndex >= 0) {
            const enhancementEl = el.querySelector('.Item_enhancementLevel__19g-e');
            if (enhancementEl) {
                const match = enhancementEl.textContent.match(/\+(\d+)/);
                enhancementLevel = match ? parseInt(match[1]) : 0;
            }
        }

        // 获取买卖价格
        let asks = 0, bids = 0;
        if (itemHrid === '/items/coin') {
            // 金币价格固定为1
            asks = bids = 1;
        } else {
            const orderBooks = await getMarketData(itemHrid);
            if (orderBooks?.[enhancementLevel]) {
                const { asks: asksList, bids: bidsList } = orderBooks[enhancementLevel];
                if (reqIndex >= 0) {
                    // 材料：获取最低卖价和最高买价
                    asks = asksList?.length > 0 ? asksList[0].price : null;
                    bids = bidsList?.length > 0 ? bidsList[0].price : null;
                } else {
                    // 产出物品：获取价格，没有订单时为0
                    asks = asksList?.[0]?.price || 0;
                    bids = bidsList?.[0]?.price || 0;
                }
            } else {
                // 没有对应强化等级的订单数据
                asks = bids = reqIndex >= 0 ? null : orderBooks ? -1 : 0;
            }
        }

        const result = { itemHrid, asks, bids, enhancementLevel };

        if (reqIndex >= 0) {
            // 获取材料数量
            const countEl = document.querySelectorAll('.SkillActionDetail_itemRequirements__3SPnA .SkillActionDetail_inputCount__1rdrn')[reqIndex];
            result.count = parseInt(countEl?.textContent?.replace(/,/g, '').match(/\d+/)?.[0]) || 1;
        } else if (dropIndex >= 0) {
            // 获取掉落数量和概率
            const dropEl = document.querySelectorAll('.SkillActionDetail_drop__26KBZ')[dropIndex];
            const text = dropEl?.textContent || '';
            result.count = parseInt(text.match(/^([\d,]+)/)?.[1]?.replace(/,/g, '')) || 1;
            result.dropRate = parseFloat(text.match(/(\d+(?:\.\d+)?)%/)?.[1]) / 100 || 1;
        }

        return result;
    };

    /**
     * 计算炼金效率加成
     * @returns {number} 效率加成百分比（小数形式）
     */
    const calculateEfficiency = () => {
        // 获取React组件的props
        const props = getReactProps(document.querySelector('.SkillActionDetail_alchemyComponent__1J55d'));
        if (!props) return 0;

        // 获取炼金技能等级
        const level = props.characterSkillMap?.get('/skills/alchemy')?.level || 0;
        
        // 获取配方等级
        let itemLevel = 0;
        const notesEl = document.querySelector('.SkillActionDetail_notes__2je2F');
        if (notesEl) {
            const match = notesEl.childNodes[0]?.textContent?.match(/\d+/);
            itemLevel = match ? parseInt(match[0]) : 0;
        }

        // 计算buff效率加成
        const buffEfficiency = (props.actionBuffs || [])
            .filter(b => b.typeHrid === '/buff_types/efficiency')
            .reduce((sum, b) => sum + (b.flatBoost || 0), 0);

        // 返回总效率：buff加成 + 技能等级超出配方等级的部分（每级1%）
        return buffEfficiency + Math.max(0, level - itemLevel) / 100;
    };

    /**
     * 检查是否有缺失的价格数据
     * @param {Object} data - 炼金数据对象
     * @param {boolean} useOptimistic - 是否使用乐观价格
     * @returns {boolean} 是否有null价格
     */
    const hasNullPrices = (data, useOptimistic) => {
        const checkItems = (items, type) => items.some(item => 
            (useOptimistic ? item.bids : item.asks) === null
        );
        
        return checkItems(data.requirements, 'buy') || 
               checkItems(data.drops, 'sell') ||
               checkItems(data.consumables, 'buy') ||
               (useOptimistic ? data.catalyst.bids : data.catalyst.asks) === null;
    };

    /**
     * 获取炼金相关的所有数据
     * @returns {Promise<Object|null>} 炼金数据对象，包含成功率、时间、材料、产出等
     */
    const getAlchemyData = async () => {
        // 获取数值的辅助函数
        const getValue = sel => parseFloat(document.querySelector(sel)?.textContent) || 0;
        
        // 获取成功率和时间成本
        const successRate = getValue('.SkillActionDetail_successRate__2jPEP .SkillActionDetail_value__dQjYH') / 100;
        const timeCost = getValue('.SkillActionDetail_timeCost__1jb2x .SkillActionDetail_value__dQjYH');

        if (!successRate || !timeCost) return null;

        // 获取所有相关DOM元素
        const reqEls = [...document.querySelectorAll('.SkillActionDetail_itemRequirements__3SPnA .Item_itemContainer__x7kH1')];
        const dropEls = [...document.querySelectorAll('.SkillActionDetail_dropTable__3ViVp .Item_itemContainer__x7kH1')];
        const consumEls = [...document.querySelectorAll('.ActionTypeConsumableSlots_consumableSlots__kFKk0 .Item_itemContainer__x7kH1')];
        const catalystEl = document.querySelector('.SkillActionDetail_catalystItemInputContainer__5zmou .ItemSelector_itemContainer__3olqe') || 
                          document.querySelector('.SkillActionDetail_catalystItemInputContainer__5zmou .SkillActionDetail_itemContainer__2TT5f');

        // 并行获取所有物品数据
        const [requirements, drops, consumables, catalyst] = await Promise.all([
            Promise.all(reqEls.map((el, i) => getItemData(el, -1, i))),
            Promise.all(dropEls.map((el, i) => getItemData(el, i))),
            Promise.all(consumEls.map(el => getItemData(el))),
            catalystEl ? getItemData(catalystEl) : Promise.resolve({ asks: 0, bids: 0 })
        ]);

        return {
            successRate, timeCost, 
            efficiency: calculateEfficiency(),
            requirements: requirements.filter(Boolean),
            drops: drops.filter(Boolean),
            catalyst: catalyst || { asks: 0, bids: 0 },
            consumables: consumables.filter(Boolean)
        };
    };

    /**
     * 计算炼金利润
     * @param {Object} data - 炼金数据对象
     * @param {boolean} useOptimistic - true为乐观估算（用买价卖，卖价买），false为悲观估算（用卖价买，买价卖）
     * @returns {number|null} 每日利润，null表示缺少价格数据
     */
    const calculateProfit = (data, useOptimistic) => {
        // 检查是否有缺失的价格数据
        if (hasNullPrices(data, useOptimistic)) return null;
        
        // 计算材料总成本
        const totalReqCost = data.requirements.reduce((sum, item) => 
            sum + (useOptimistic ? item.bids : item.asks) * item.count, 0);
        
        // 计算每次尝试的总成本（包括失败时的材料损失）
        const catalystPrice = useOptimistic ? data.catalyst.bids : data.catalyst.asks;
        const costPerAttempt = totalReqCost * (1 - data.successRate) + (totalReqCost + catalystPrice) * data.successRate;

        // 计算每次尝试的收入
        const incomePerAttempt = data.drops.reduce((sum, drop) => {
            const price = useOptimistic ? drop.asks : drop.bids;
            let income = price * drop.dropRate * drop.count * data.successRate;
            // 非金币物品有2%的市场税
            if (drop.itemHrid !== '/items/coin') income *= 0.98;
            return sum + income;
        }, 0);

        // 计算消耗品成本（药水等，持续300秒）
        const drinkCost = data.consumables.reduce((sum, item) => 
            sum + (useOptimistic ? item.bids : item.asks), 0);

        // 计算净利润
        const netProfitPerAttempt = incomePerAttempt - costPerAttempt;
        // 每秒利润 = (净利润 * 效率加成) / 时间成本 - 药水成本/300秒
        const profitPerSecond = (netProfitPerAttempt * (1 + data.efficiency)) / data.timeCost - drinkCost / 300;
        
        // 返回每日利润（24小时 * 3600秒）
        return Math.round(profitPerSecond * 86400);
    };

    /**
     * 格式化利润显示
     * @param {number} profit - 利润数值
     * @returns {string} 格式化后的字符串（如1.2M, 3.5K等）
     */
    const formatProfit = profit => {
        const abs = Math.abs(profit);
        const sign = profit < 0 ? '-' : '';
        if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + 'B';
        if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + 'M';
        if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
        return profit.toString();
    };

    /**
     * 获取当前状态的指纹，用于检测变化
     * @returns {string} 状态指纹字符串
     */
    const getStateFingerprint = () => {
        const consumables = document.querySelectorAll('.ActionTypeConsumableSlots_consumableSlots__kFKk0 .Item_itemContainer__x7kH1');
        const successRate = document.querySelector('.SkillActionDetail_successRate__2jPEP .SkillActionDetail_value__dQjYH')?.textContent || '';
        const consumablesState = Array.from(consumables).map(el => 
            el.querySelector('svg use')?.getAttribute('href') || 'empty').join('|');
        return `${consumablesState}:${successRate}`;
    };

    /**
     * 防抖更新函数，避免频繁计算
     */
    const debounceUpdate = () => {
        clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
            if (document.getElementById('alchemy-profit-display')) updateProfitDisplay();
        }, 200);
    };

    /**
     * 更新利润显示
     * 获取炼金数据并计算悲观/乐观利润，更新UI显示
     */
    const updateProfitDisplay = async () => {
        const [pessimisticEl, optimisticEl] = ['pessimistic-profit', 'optimistic-profit'].map(id => document.getElementById(id));
        if (!pessimisticEl || !optimisticEl) return;

        // 检查API是否就绪
        if (!apiReady) {
            pessimisticEl.textContent = optimisticEl.textContent = t.waitingAPI;
            pessimisticEl.style.color = optimisticEl.style.color = 'var(--color-warning)';
            return;
        }

        try {
            // 获取炼金数据
            const data = await getAlchemyData();
            if (!data) {
                pessimisticEl.textContent = optimisticEl.textContent = t.noData;
                pessimisticEl.style.color = optimisticEl.style.color = 'var(--color-disabled)';
                return;
            }

            // 计算并显示悲观和乐观利润
            [false, true].forEach((useOptimistic, index) => {
                const profit = calculateProfit(data, useOptimistic);
                const el = index ? optimisticEl : pessimisticEl;
                
                if (profit === null) {
                    el.textContent = t.noData;
                    el.style.color = 'var(--color-disabled)';
                } else {
                    el.textContent = formatProfit(profit);
                    el.style.color = profit >= 0 ? 'var(--color-market-buy)' : 'var(--color-market-sell)';
                }
            });
        } catch {
            pessimisticEl.textContent = optimisticEl.textContent = t.error;
            pessimisticEl.style.color = optimisticEl.style.color = 'var(--color-warning)';
        }
    };

    /**
     * 设置DOM观察器
     * @param {string} selector - CSS选择器
     * @param {Function} callback - 回调函数
     * @param {Object} options - 观察选项
     * @returns {MutationObserver|null} 观察器实例
     */
    const setupObserver = (selector, callback, options = {}) => {
        const element = document.querySelector(selector);
        if (!element) return null;

        const observer = new MutationObserver(callback);
        observer.observe(element, { childList: true, subtree: true, attributes: true, ...options });
        return observer;
    };

    /**
     * 设置UI管理器
     * 负责监听页面变化，动态添加/移除利润显示组件
     */
    const setupUIManager = () => {
        let observers = [];

        // 主观察器：监听整个页面的变化
        const mainObserver = new MutationObserver(() => {
            const alchemyComponent = document.querySelector('.SkillActionDetail_alchemyComponent__1J55d');
            const instructionsEl = document.querySelector('.SkillActionDetail_instructions___EYV5');
            const infoContainer = document.querySelector('.SkillActionDetail_info__3umoI');
            const existingDisplay = document.getElementById('alchemy-profit-display');

            // 判断是否应该显示利润计算器（在炼金页面且不是指导页面）
            const shouldShow = alchemyComponent && !instructionsEl && infoContainer;

            if (shouldShow && !existingDisplay) {
                // 创建利润显示容器
                const container = document.createElement('div');
                container.id = 'alchemy-profit-display';
                container.style.cssText = 'display:flex;flex-direction:column;gap:10px;font-family:Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;letter-spacing:0.00938em;color:var(--color-text-dark-mode);font-weight:400';
                container.innerHTML = `
                    <div style="display:flex;align-items:center;gap:8px">
                        <span style="color:var(--color-space-300)">${t.pessimisticProfit}</span>
                        <span id="pessimistic-profit" style="font-weight:400">${apiReady ? t.calculating : t.waitingAPI}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px">
                        <span style="color:var(--color-space-300)">${t.optimisticProfit}</span>
                        <span id="optimistic-profit" style="font-weight:400">${apiReady ? t.calculating : t.waitingAPI}</span>
                    </div>
                `;
                infoContainer.appendChild(container);

                lastState = getStateFingerprint();
                
                // 清理旧的观察器并设置新的
                observers.forEach(obs => obs?.disconnect());
                observers = [
                    // 监听消耗品槽位变化
                    setupObserver('.ActionTypeConsumableSlots_consumableSlots__kFKk0', () => {
                        const currentState = getStateFingerprint();
                        if (currentState !== lastState) {
                            lastState = currentState;
                            debounceUpdate();
                        }
                    }),
                    // 监听成功率变化
                    setupObserver('.SkillActionDetail_successRate__2jPEP .SkillActionDetail_value__dQjYH', () => {
                        const currentState = getStateFingerprint();
                        if (currentState !== lastState) {
                            lastState = currentState;
                            debounceUpdate();
                        }
                    }, { characterData: true })
                ].filter(Boolean);

                // 立即更新显示状态，确保API状态正确反映
                setTimeout(updateProfitDisplay, apiReady ? 50 : 100);
            } else if (!shouldShow && existingDisplay) {
                // 移除利润显示并清理观察器
                existingDisplay.remove();
                observers.forEach(obs => obs?.disconnect());
                observers = [];
            }
        });

        // 监听整个页面的变化
        mainObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

        // 监听点击事件，处理可能触发数据变化的点击
        document.addEventListener('click', (event) => {
            if (event.target.closest('.AlchemyPanel_alchemyPanel__1Sa8_ .MuiTabs-flexContainer') ||
                event.target.closest('[class*="ItemSelector"]') ||
                event.target.closest('.Item_itemContainer__x7kH1') ||
                event.target.closest('[class*="SkillAction"]') ||
                event.target.closest('.MuiPopper-root.MuiTooltip-popper.MuiTooltip-popperInteractive.css-w9tg40')) {
                setTimeout(() => document.getElementById('alchemy-profit-display') && debounceUpdate(), 1);
            }
        });
    };

    /**
     * 等待AutoBuyAPI加载完成
     * @returns {Promise<boolean>} API是否成功加载
     */
    const waitForAPI = () => new Promise(resolve => {
        let attempts = 0;
        const check = () => {
            console.log(`%c${t.apiCheckAttempt} ${++attempts}/20`, 'color: #2196F3; font-weight: normal;');
            
            // 检查API是否可用并尝试初始化钩子
            if (checkAPI() && initHook()) {
                apiReady = true;
                console.log(`%c${t.loadSuccess}`, 'color: #4CAF50; font-weight: bold;');
                
                // 如果UI已经存在，立即更新显示状态
                const existingDisplay = document.getElementById('alchemy-profit-display');
                if (existingDisplay) {
                    setTimeout(updateProfitDisplay, 100);
                }
                
                return resolve(true);
            }
            
            // 达到最大尝试次数，超时
            if (attempts >= 20) {
                console.warn(`%c${t.apiTimeout}`, 'color: #FF9800; font-weight: bold;');
                return resolve(false);
            }
            
            // 1秒后重试
            setTimeout(check, 1e3);
        };
        check();
    });

    /**
     * 初始化脚本
     * 设置UI管理器并等待API加载
     */
    const initialize = async () => {
        setupUIManager();
        const apiLoaded = await waitForAPI();
        if (!apiLoaded) console.error(`%c${t.loadFailed}`, 'color: #F44336; font-weight: bold;');
    };

    // 根据页面加载状态决定何时初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();