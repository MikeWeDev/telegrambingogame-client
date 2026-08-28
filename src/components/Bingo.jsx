import bingoCards from "../assets/bingoCards.json";
import { useEffect, useState, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLocation } from "react-router-dom";

// ─── FIX P0: Use environment variable instead of hardcoded production URL ─────
// Set VITE_API_BASE_URL in your .env files:
//   .env.development  → VITE_API_BASE_URL=http://localhost:5000
//   .env.production   → VITE_API_BASE_URL=https://bingoback.bingoogame.com
// In Netlify: add VITE_API_BASE_URL as an environment variable in Site Settings.

function Bingo({ isBlackToggleOn, setCartelaIdInParent, cartelaIds, socket, otherSelectedCards, setOtherSelectedCards, emitLockRef }) {

  const [searchParams] = useSearchParams();
  const urlTelegramId  = searchParams.get("user");
  const urlGameId      = searchParams.get("game");
  const location       = useLocation();
  const prevPathRef    = useRef(null);

  useEffect(() => {
    const storedTelegramId = localStorage.getItem("telegramId");
    const storedGameId     = localStorage.getItem("gameChoice");
    if (urlTelegramId && urlTelegramId !== storedTelegramId) localStorage.setItem("telegramId", urlTelegramId);
    if (urlGameId     && urlGameId     !== storedGameId)     localStorage.setItem("gameChoice", urlGameId);
  }, [urlTelegramId, urlGameId]);

  const telegramId = urlTelegramId || localStorage.getItem("telegramId");
  const gameId     = urlGameId     || localStorage.getItem("gameChoice");

  const navigate = useNavigate();

  const [selectedCartelas,  setSelectedCartelas]  = useState([]);
  const [gameStatus,        setGameStatus]        = useState(false);
  const [userBalance,       setUserBalance]       = useState(null);
  const [bonusBalance,      setUserBonusBalance]  = useState(null);
  const [alertMessage,      setAlertMessage]      = useState("");
  const [response,          setResponse]          = useState("");
  const [count,             setCount]             = useState(0);
  const [playerCount,       setPlayerCount]       = useState(0);
  const [gameStarted,       setGameStarted]       = useState(false);
  const [countdown,         setCountdown]         = useState(0);
  const [isStarting,        setIsStarting]        = useState(false);
  const hasInitialSyncRun   = useRef(false);
  const lastRequestIdRef    = useRef(0);
  const [dbUsername,        setDbUsername]        = useState("");
  const [announcement, setAnnouncement] = useState(null);

  // ─── FIX P2: Socket connection state for reconnect overlay ───────────────
  const [socketConnected, setSocketConnected] = useState(socket?.connected ?? true);
  const [reconnectSeconds, setReconnectSeconds] = useState(0);
  const reconnectTimerRef = useRef(null);

  // ─── FIX P0: Stable refs for values used inside socket callbacks ──────────
  const otherSelectedCardsRef = useRef(otherSelectedCards);
  const cartelaIdsRef         = useRef(cartelaIds);

  useEffect(() => { otherSelectedCardsRef.current = otherSelectedCards; }, [otherSelectedCards]);
  useEffect(() => { cartelaIdsRef.current         = cartelaIds; },         [cartelaIds]);

  const [currentPage,    setCurrentPage]    = useState(1);
  const CARDS_PER_PAGE   = 50;
  const COST_PER_CARD    = Number(gameId);
  const MAX_CARDS_ALLOWED = 2;

  const startCardId = (currentPage - 1) * CARDS_PER_PAGE + 1;
  const endCardId   =  currentPage      * CARDS_PER_PAGE;

  const cardsForCurrentPage = useMemo(() => {
    return bingoCards.filter(card => card.id >= startCardId && card.id <= endCardId);
  }, [startCardId, endCardId]);

  const [pendingCardId, setPendingCardId] = useState(null);

  const bgGradient      = isBlackToggleOn ? "bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900"     : "bg-gradient-to-br from-violet-300 via-purple-400 to-indigo-500";
  const alertBg         = isBlackToggleOn ? "bg-red-900"   : "bg-red-100";
  const alertText       = isBlackToggleOn ? "text-red-300" : "text-red-700";
  const alertBorder     = isBlackToggleOn ? "border-red-700" : "border-red-500";
  const cardBg          = isBlackToggleOn ? "bg-white/10"  : "bg-white";
  const cardText        = isBlackToggleOn ? "text-indigo-300" : "text-purple-400";
  const myCardBg        = isBlackToggleOn ? "bg-green-600 text-white"  : "bg-green-500 text-white";
  const otherCardBg     = isBlackToggleOn ? "bg-yellow-600 text-black" : "bg-yellow-400 text-black";
  const defaultCardBg   = isBlackToggleOn ? "bg-gray-700 text-white"   : "bg-purple-100 text-black";
  const cellBg          = isBlackToggleOn ? "bg-gray-800 text-white"   : "bg-purple-100 text-black";
  const refreshBtnBg    = isBlackToggleOn ? "bg-blue-700"  : "bg-blue-500";
  const startBtnEnabledBg  = isBlackToggleOn ? "bg-orange-600 hover:bg-orange-700" : "bg-orange-500 hover:bg-orange-600";
  const startBtnDisabledBg = "bg-gray-600 cursor-not-allowed";
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

  const fetchUserData = async () => {
    try {
        const res  = await fetch(`${BACKEND_URL}/api/users/getUser?telegramId=${telegramId}`);
        const data = await res.json();
        if (res.ok) {
            setUserBalance(data.balance);
            setUserBonusBalance(data.bonus_balance);
            if (data.username) setDbUsername(data.username);
        }
    } catch (err) {
        console.error("Error fetching user data:", err);
    }
};

  const restoreSelectedCartelas = (cardIds) => {
    const cards = cardIds
      .map(id => bingoCards.find(card => card.id === Number(id)))
      .filter(Boolean);
    setSelectedCartelas(cards);
  };

  function getTelegramInitData() {
    if (!window.Telegram?.WebApp) return null;
    return window.Telegram.WebApp.initData;
  }

  // ─── Main socket-listener effect ──────────────────────────────────────────
  useEffect(() => {
    console.log("🎬 CLIENT: Main useEffect RUNNING - telegramId:", telegramId, "gameId:", gameId);
    
    if (!telegramId || !gameId) {
      console.error("Missing telegramId or gameId for game page.");
      navigate("/");
      return;
    }

    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }

    const handleCardSelections = (cards) => {
      if (lastRequestIdRef.current > 0) return;

      const newOtherSelectedCards = {};
      const myCardIds = [];

      for (const [cardId, tId] of Object.entries(cards)) {
        if (tId === telegramId) {
          myCardIds.push(parseInt(cardId));
        } else {
          if (!newOtherSelectedCards[tId]) newOtherSelectedCards[tId] = [];
          newOtherSelectedCards[tId].push(parseInt(cardId));
        }
      }

      setCartelaIdInParent(myCardIds);
      restoreSelectedCartelas(myCardIds);
      setOtherSelectedCards(newOtherSelectedCards);
    };

    const handleCardsReleased = ({ telegramId: releasedTelegramId, cardIds }) => {
      const releasedSet = new Set(
        (Array.isArray(cardIds) ? cardIds : [cardIds])
          .map(id => Number(id))
          .filter(id => !isNaN(id))
      );

      setOtherSelectedCards((prev) => {
        const newState      = { ...prev };
        const strReleasedId = String(releasedTelegramId);
        const playerCardList = newState[strReleasedId];

        if (playerCardList && Array.isArray(playerCardList)) {
          const newCardList = playerCardList.filter(id => !releasedSet.has(Number(id)));
          if (newCardList.length === 0) delete newState[strReleasedId];
          else newState[strReleasedId] = newCardList;
        }
        return newState;
      });
    };

    const handleInitialCardStates = (data) => {
      console.log("📥 CLIENT: initialCardStates received", JSON.stringify(data));
      console.log("📥 CLIENT: telegramId:", telegramId, "gameId:", gameId);
      
      const { takenCards } = data;
      console.log("📥 CLIENT: takenCards received:", JSON.stringify(takenCards));

      if (lastRequestIdRef.current > 0) {
        console.log("📥 CLIENT: Skipping initialCardStates - lastRequestIdRef > 0");
        return;
      }

      const newOtherSelectedCardsMap = {};
      const myRestoredCardIds = [];

      for (const cardId in takenCards) {
        const takenByTelegramId = takenCards[cardId].takenBy;
        if (takenByTelegramId === telegramId) {
          myRestoredCardIds.push(Number(cardId));
        } else {
          if (!newOtherSelectedCardsMap[takenByTelegramId]) newOtherSelectedCardsMap[takenByTelegramId] = [];
          newOtherSelectedCardsMap[takenByTelegramId].push(Number(cardId));
        }
      }
      console.log("📥 CLIENT: myRestoredCardIds:", JSON.stringify(myRestoredCardIds));
      console.log("📥 CLIENT: newOtherSelectedCardsMap:", JSON.stringify(newOtherSelectedCardsMap));
      
      setOtherSelectedCards(newOtherSelectedCardsMap);
      console.log("📥 CLIENT: setOtherSelectedCards called");

      // ─── FIX P2: Use localStorage instead of sessionStorage ───────────────
      // sessionStorage is cleared when the Telegram WebApp closes and reopens,
      // causing a flash of "no cards selected" even though the server state is
      // correct. localStorage with a same-session check is more resilient.
    if (myRestoredCardIds.length > 0) {
      restoreSelectedCartelas(myRestoredCardIds);
      setCartelaIdInParent(myRestoredCardIds);
      localStorage.setItem(`mySelectedCardIds:${gameId}`, myRestoredCardIds.join(","));
      console.log("📥 CLIENT: Restored", myRestoredCardIds.length, "cards from server");
    } else {
      // Server says no cards held — clear everything including stale localStorage
      setSelectedCartelas([]);
      setCartelaIdInParent([]);
      localStorage.removeItem(`mySelectedCardIds:${gameId}`);
      console.log("📥 CLIENT: No cards on server - cleared local state");
    }
    console.log("📥 CLIENT: handleInitialCardStates COMPLETE");
    };

// In performInitialGameSync, before emitting:
    const performInitialGameSync = () => {
      console.log("🔄 CLIENT: performInitialGameSync called");
      console.log("🔄 CLIENT: hasInitialSyncRun.current:", hasInitialSyncRun.current);
      console.log("🔄 CLIENT: socket.connected:", socket?.connected);
      console.log("🔄 CLIENT: telegramId:", telegramId);
      console.log("🔄 CLIENT: gameId:", gameId);
      
      if (hasInitialSyncRun.current) {
        console.log("🔄 CLIENT: Skipping - hasInitialSyncRun already true");
        return;
      }
      if (!socket?.connected) {
        console.log("🔄 CLIENT: Skipping - socket not connected");
        return;
      }
      if (!telegramId) {
        console.log("🔄 CLIENT: Skipping - no telegramId");
        return;
      }
      if (!gameId) {
        console.log("🔄 CLIENT: Skipping - no gameId");
        return;
      }
      
      const initData = getTelegramInitData();
      console.log("🔄 CLIENT: initData:", initData ? "present" : "NULL");
      
      if (!initData) {
        console.warn("⚠️ initData unavailable — retrying in 500ms");
        setTimeout(performInitialGameSync, 500); // retry once after Telegram WebApp loads
        return;
      }
      hasInitialSyncRun.current = true;
      console.log("🔄 CLIENT: EMITTING userJoinedGame with initData, gameId:", gameId);
      socket.emit("userJoinedGame", { initData, gameId });
    };

    // ─── FIX P2: Socket disconnect/reconnect overlay handlers ────────────────
    const handleSocketDisconnect = () => {
      console.log("🔌 CLIENT: socket DISCONNECTED");
      setSocketConnected(false);
      hasInitialSyncRun.current = false;
      let secs = 0;
      reconnectTimerRef.current = setInterval(() => {
        secs += 1;
        setReconnectSeconds(secs);
      }, 1000);
      emitLockRef.current = false;     // ← ADD: release lock on disconnect
      lastRequestIdRef.current = 0;    // ← ADD: reset request id

    };

    const handleSocketReconnect = () => {
      console.log("🔌 CLIENT: socket RECONNECTED");
      setSocketConnected(true);
      setReconnectSeconds(0);
      if (reconnectTimerRef.current) {
        clearInterval(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };



    const handleCardsUpdated = ({ released, selected, ownerId }) => {
      if (String(ownerId) === String(telegramId)) return;
      setOtherSelectedCards(prev => {
        const newState   = { ...prev };
        let updatedCards = (newState[ownerId] || [])
          .filter(id => !released.map(Number).includes(Number(id)));
        updatedCards = Array.from(new Set([...updatedCards, ...selected.map(Number)]));
        // Clean up instead of storing empty array
        if (updatedCards.length > 0) newState[ownerId] = updatedCards;
        else delete newState[ownerId];
        return newState;
      });
    };

    const handleBatchCardsUpdated = ({ updates }) => {
      setOtherSelectedCards(prev => {
        const newState = { ...prev };
        updates.forEach(({ ownerId, selected = [], released = [] }) => {
          if (String(ownerId) === String(telegramId)) return;
          let cards = newState[ownerId] || [];
          if (released.length > 0) {
            const releasedSet = new Set(released.map(Number));
            cards = cards.filter(id => !releasedSet.has(Number(id)));
          }
          if (selected.length > 0) {
            cards = [...new Set([...cards, ...selected.map(Number)])];
          }
          if (cards.length > 0) newState[ownerId] = cards;
          else delete newState[ownerId];
        });
        // Guard: remove players with 0 cards to prevent unbounded growth
        Object.keys(newState).forEach(id => {
          if (!newState[id] || newState[id].length === 0) delete newState[id];
        });
        return newState;
      });
    };


    const handleUserConnected  = (res) => setResponse(res.telegramId);
    const handleBalanceUpdated = (newBalance) => setUserBalance(newBalance);
    const handleGameStatusUpdate = (status) => setGameStatus(status);
    const handleSocketError    = (err) => { console.error(err); setAlertMessage(err.message); };

   
    socket.on("cardsUpdated", handleCardsUpdated);
    socket.on("batchCardsUpdated", handleBatchCardsUpdated);
    socket.on("initialCardStates",      handleInitialCardStates);
    socket.on("userconnected",    handleUserConnected);
    socket.on("balanceUpdated",   handleBalanceUpdated);
    socket.on("gameStatusUpdate", handleGameStatusUpdate);
    socket.on("error",            handleSocketError);
    socket.on("currentCardSelections",  handleCardSelections);

    socket.on("cardConfirmed", (data) => {
      if (data.requestId !== lastRequestIdRef.current) return;
      const confirmedCardIds = Array.isArray(data.currentHeldCardIds)
        ? data.currentHeldCardIds.map(Number)
        : [];
      setCartelaIdInParent(confirmedCardIds);
      restoreSelectedCartelas(confirmedCardIds);
      localStorage.setItem(`mySelectedCardIds:${gameId}`, confirmedCardIds.join(","));
      setGameStatus("Ready to Start");
      lastRequestIdRef.current = 0;
      emitLockRef.current      = false;
    });

    socket.on("cardUnavailable", ({ cardId, currentHeldCardIds }) => {
      setAlertMessage(`🚫 Card ${cardId} is already taken by another player.`);
      const updatedCardIds = currentHeldCardIds || (Array.isArray(cartelaIdsRef.current) ? cartelaIdsRef.current : []);
      setCartelaIdInParent(updatedCardIds);
      restoreSelectedCartelas(updatedCardIds);
      localStorage.setItem(`mySelectedCardIds:${gameId}`, updatedCardIds.join(","));
      lastRequestIdRef.current = 0;
      emitLockRef.current      = false;
    });

    socket.on("cardError", ({ message, requestId, currentHeldCardIds }) => {
      emitLockRef.current = false;
      lastRequestIdRef.current = 0;
      if (requestId === lastRequestIdRef.current) {
        setAlertMessage(message);
        setCartelaIdInParent(currentHeldCardIds || []);
        restoreSelectedCartelas(currentHeldCardIds || []);
      }
    });


    socket.on("cardsReset", ({ gameId: resetGameId }) => {
      if (resetGameId === gameId) {
        setOtherSelectedCards({});
        setSelectedCartelas([]);
        setCartelaIdInParent([]);
        localStorage.removeItem(`mySelectedCardIds:${gameId}`);
        hasInitialSyncRun.current = false;
      }
    });

      socket.on("announcement", ({ type, message }) => {
        setAnnouncement({ type, message });
    });

    socket.on("balanceUpdated", ({ telegramId, balance, bonus_balance }) => {
    if (String(telegramId) === String(userTelegramId)) {
          setUserBalance(balance);
          setUserBonusBalance(bonus_balance);
          // Also update the local cache so getUser returns fresh data
          // No HTTP call needed — server pushed the value
          }
      });


    const handleCountdownTick = ({ countdown }) => setCountdown(countdown);

    const handleConnectForSync = () => {
      console.log("🔌 CLIENT: socket CONNECT event");
      handleSocketReconnect();
      if (!hasInitialSyncRun.current) {
        console.log("🔌 CLIENT: calling performInitialGameSync from connect handler");
        performInitialGameSync();
      } else {
        console.log("🔌 CLIENT: skipping performInitialGameSync - already ran");
      }
    };

    socket.on("connect",    handleConnectForSync);
    socket.on("disconnect", handleSocketDisconnect);
    socket.on("countdownTick", handleCountdownTick);
  

    console.log("🎬 CLIENT: About to call performInitialGameSync at end of effect");
    performInitialGameSync();
    console.log("🎬 CLIENT: About to call fetchUserData");
    fetchUserData();

    return () => {
      socket.off("countdownTick",        handleCountdownTick);
      socket.off("userconnected");
      socket.off("initialCardStates",    handleInitialCardStates);
      socket.off("balanceUpdated");
      socket.off("gameStatusUpdate");
      socket.off("currentCardSelections", handleCardSelections);
      socket.off("cardConfirmed");
      socket.off("cardUnavailable");
      socket.off("cardError");
      socket.off("cardsReleased",        handleCardsReleased);
      socket.off("gameid");
      socket.off("error");
      socket.off("cardsReset");
      socket.off("connect",              handleConnectForSync);
      socket.off("disconnect",           handleSocketDisconnect);
      socket.off("cardsUpdated",      handleCardsUpdated);
      socket.off("batchCardsUpdated", handleBatchCardsUpdated);
      socket.off("announcement");
      socket.off("balanceUpdated");
      if (reconnectTimerRef.current) clearInterval(reconnectTimerRef.current);
    };

  }, [telegramId, gameId, navigate, socket]);

  // ── Game state listeners ───────────────────────────────────────────────────
  useEffect(() => {
    socket.on("gameFinished", () => setGameStarted(false));
       socket.on("gameEnded", () => {
       setGameStarted(false);
       setIsStarting(false);
       setAlertMessage("");
       localStorage.removeItem(`mySelectedCardIds:${gameId}`);
    });
     socket.on("gameEnd", () => {
        setGameStarted(false);
       setIsStarting(false);
       setAlertMessage("");
       localStorage.removeItem(`mySelectedCardIds:${gameId}`);
    });

    socket.on("gameReset", () => {
      setGameStarted(false);
      setIsStarting(false);
      setCountdown(0);
      setAlertMessage("");
      setSelectedCartelas([]);
      setCartelaIdInParent([]);
      setOtherSelectedCards({});
      localStorage.removeItem(`mySelectedCardIds:${gameId}`);
    });

    socket.on("playerCountUpdate", ({ playerCount }) => setPlayerCount(playerCount));

    socket.on("gameStatusChanged", ({ status, playerCount, countdown: cd }) => {
        if (playerCount !== undefined) setPlayerCount(playerCount);
        if (cd !== null && cd !== undefined) setCountdown(cd);
        if (status === "active" || status === "starting") {
            setGameStarted(status === "active");
            // disable start button
        } else {
            setGameStarted(false);
        }
    });
    return () => {
      socket.off("gameFinished");
      socket.off("gameEnded");
      socket.off("gameEnd");
      socket.off("gameReset");
      socket.off("playerCountUpdate");
      socket.off("gameStatusChanged");
    };
  }, [socket, gameId]);

  // ─── Card click handler ───────────────────────────────────────────────────
  const handleNumberClick = (number) => {
    if (emitLockRef.current) return;

    const currentCartelaIds = cartelaIdsRef.current;

    const isOtherCard = otherSelectedCardsRef.current &&
      Object.values(otherSelectedCardsRef.current).some(cardArray => cardArray.includes(number));
    if (isOtherCard) return;

    if (!Array.isArray(currentCartelaIds)) return;

    const isSelected = currentCartelaIds.includes(number);
    let newSelectedIds;

    if (isSelected) {
      newSelectedIds = currentCartelaIds.filter(id => id !== number);
    } else {
      const totalBalance        = (userBalance || 0) + (bonusBalance || 0);
      const balanceForTwoCards  = MAX_CARDS_ALLOWED * COST_PER_CARD;
      const shouldForceReplace  = currentCartelaIds.length === 1 && totalBalance < balanceForTwoCards;

      if (currentCartelaIds.length >= MAX_CARDS_ALLOWED || shouldForceReplace) {
        newSelectedIds = [...currentCartelaIds.slice(1), number];
      } else {
        newSelectedIds = [...currentCartelaIds, number];
      }
    }

    const requiredBalance = newSelectedIds.length * COST_PER_CARD;
    if (newSelectedIds.length > 0 && ((userBalance || 0) + (bonusBalance || 0)) < requiredBalance) {
      setAlertMessage("🚫 ሂሳቦን ይሙሉ ( Insufficient funds )");
      setTimeout(() => setAlertMessage(""), 5000);
      return;
    }

    const newSelectedCardsData = newSelectedIds
      .map(id => bingoCards.find(card => card.id === id))
      .filter(Boolean);

    setCartelaIdInParent(newSelectedIds);
    setSelectedCartelas(newSelectedCardsData);

    lastRequestIdRef.current += 1;
    const requestId         = lastRequestIdRef.current;
    emitLockRef.current     = true;

    socket.emit("cardSelected", {
      telegramId,
      gameId,
      cardIds: newSelectedIds,
      requestId,
    });
  };

  const resetGame = () => {
    const initData = getTelegramInitData();
    socket.emit("userJoinedGame", { initData, gameId });
    hasInitialSyncRun.current = false;
    setOtherSelectedCards({});
    setSelectedCartelas([]);
    setCartelaIdInParent([]);
    localStorage.removeItem(`mySelectedCardIds:${gameId}`);
    fetchUserData();
  };

  const startGame = async () => {
    const currentCartelaIds = cartelaIdsRef.current;
    if (isStarting || !Array.isArray(currentCartelaIds) || currentCartelaIds.length === 0) return;

    setIsStarting(true);

    try {
      const tg          = window.Telegram?.WebApp;
      const tgUser      = tg?.initDataUnsafe?.user;
      const finalUsername = tgUser?.username
        ? `@${tgUser.username}`
        : tgUser?.first_name
          ? `${tgUser.first_name} ${tgUser.last_name || ""}`.trim()
          : dbUsername || `User ${telegramId}`;

      // ─── FIX P0: Use env var instead of hardcoded URL ──────────────────────
      const response = await fetch(`${BACKEND_URL}/api/games/start`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ gameId, telegramId, username: finalUsername, cardIds: currentCartelaIds }),
      });

      const data = await response.json();

      if (response.status === 403) {
        setAlertMessage(data.message);
        return;
      }

      if (response.ok && data.success) {
        const { GameSessionId: currentSessionId } = data;
        socket.emit("joinGame", {
          gameId,
          telegramId,
          GameSessionId:    currentSessionId,
          userHeldCardIds:  currentCartelaIds,
        });
        navigate("/game", {
          state: {
            gameId,
            telegramId,
            GameSessionId:   currentSessionId,
            cartelaIds:      currentCartelaIds,
            selectedCartelas,
            playerCount:     1,
          },
        });
      } else if (response.status === 400 && data.GameSessionId) {
        setAlertMessage(data.message || "🚫 A game is already running. Please wait!!!");
        setGameStarted(true);
      } else {
        setAlertMessage(data.error || "Error joining the game lobby.");
        console.error("Game start error:", data.error);
      }
    } catch (error) {
      setAlertMessage("Error connecting to the backend");
      console.error("Connection error:", error);
    } finally {
      setIsStarting(false);
      setTimeout(() => setAlertMessage(""), 4000);
    }
  };

  return (
    <>
      {/* ─── FIX P2: Socket reconnect overlay ───────────────────────────────── */}
      {!socketConnected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8 max-w-xs w-full text-center">
            <div className="text-4xl mb-4 animate-spin">🔄</div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-2">Reconnecting...</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Lost connection. Reconnecting ({reconnectSeconds}s)...
            </p>
            <p className="text-xs text-gray-400 mt-2">Your cards are still reserved.</p>
          </div>
        </div>
      )}

      <div className={`flex flex-col items-center p-3 pb-20 min-h-screen ${bgGradient} text-white w-full overflow-hidden`}>
        {alertMessage && (
          <div className="fixed top-0 left-0 w-full flex justify-center z-50">
            <div className={`flex items-center max-w-sm w-full p-3 m-2 ${alertBg} ${alertBorder} border-l-4 ${alertText} rounded-md shadow-lg`}>
              <svg className={`w-5 h-5 mr-2 ${alertText}`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10c0 4.418-3.582 8-8 8s-8-3.582-8-8 3.582-8 8-8 8 3.582 8 8zM9 7a1 1 0 012 0v3a1 1 0 01-2 0V7zm1 6a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
              </svg>
              <span className="flex-1 text-sm">{alertMessage}</span>
              <button className="text-gray-500 hover:text-gray-700" onClick={() => setAlertMessage("")}>✕</button>
            </div>
          </div>
        )}

        <div className="flex flex-row flex-wrap justify-center gap-2 w-full max-w-xl text-white text-center mb-2">
          <div className="flex flex-col justify-center w-1/5 bg-[#3D74B6] max-h-[24vh] rounded-2xl shadow-lg transition-transform transform hover:scale-105">
            <p className="text-sm sm:text-base font-semibold tracking-wide opacity-90">Balance</p>
            <span className="text-md sm:text-md font-extrabold block">{userBalance !== null ? `${userBalance} ብር` : "Loading..."}</span>
          </div>

          <div className="flex flex-col justify-center w-1/5 bg-[#51B33B] max-h-[24vh] rounded-2xl shadow-lg transition-transform transform hover:scale-105">
            <p className="text-sm sm:text-base font-semibold tracking-wide opacity-90">Bonus</p>
            <span className="text-md sm:text-md font-extrabold block">{bonusBalance !== null ? `${bonusBalance} ብር` : "Loading..."}</span>
          </div>

          <div className="flex flex-col justify-center w-1/5 items-center bg-gradient-to-br from-blue-500 via-cyan-500 to-sky-400 max-h-[24vh] shadow-lg rounded-2xl transition-transform transform hover:scale-105">
            {gameStarted ? (
              <button className="flex flex-col justify-center items-center text-white font-extrabold text-lg sm:text-xl">
                <span className="animate-bounce">Wait 🛑</span>
              </button>
            ) : (
              <button className="flex flex-col justify-center items-center text-white font-extrabold text-lg sm:text-xl">
                <span>PLAY</span><span className="animate-bounce">▶️</span>
              </button>
            )}
          </div>

          <div className="flex flex-col justify-center w-1/5 bg-[#FFD93D] max-h-[24vh] rounded-2xl shadow-lg transition-transform transform hover:scale-105">
            <p className="text-sm sm:text-base font-semibold tracking-wide opacity-90">ባለ</p>
            <span className="text-lg sm:text-xl font-extrabold block">{gameId}</span>
          </div>

          <div className="flex items-center justify-between w-[85%] max-h-[5vh] bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 rounded-2xl shadow-lg p-3 text-white transition-all duration-300 hover:scale-105 hover:shadow-2xl">
            <p className="text-lg font-extrabold tracking-wider drop-shadow-md flex items-center gap-2">
              {gameStarted ? "🎯 Game Started!" : countdown > 0 ? `⏳ ${countdown}s` : "🎉 Join the Game"}
            </p>
            <div className="w-1/3 h-4 bg-white/30 rounded-full overflow-hidden ml-4">
              <div
                className={`h-full transition-all duration-500 ${
                  gameStarted ? "bg-green-400 animate-pulse"
                  : countdown > 0 ? "bg-yellow-400" : "bg-blue-400"
                }`}
                style={{
                  width: gameStarted || countdown <= 0
                    ? "100%"
                    : `${((30 - countdown) / 30) * 100}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Card pagination */}
        <div className="flex justify-center items-center gap-4 mb-2">
          <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
            className={`px-2 py-1 rounded-full text-sm font-semibold transition-colors duration-200 ${currentPage === 1 ? "bg-gray-500 text-gray-300 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}>
            Cards 1-50
          </button>
          <button onClick={() => setCurrentPage(2)} disabled={currentPage === 2 || bingoCards.length < 51}
            className={`px-2 py-1 rounded-full text-sm font-semibold transition-colors duration-200 ${currentPage === 2 ? "bg-gray-500 text-gray-300 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}>
            Cards 51-{Math.min(100, bingoCards.length)}
          </button>
          {bingoCards.length > 100 && (
            <button onClick={() => setCurrentPage(3)} disabled={currentPage === 3 || bingoCards.length < 101}
              className={`px-2 py-1 rounded-full text-sm font-semibold transition-colors duration-200 ${currentPage === 3 ? "bg-gray-500 text-gray-300 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}>
              Cards 101-{Math.min(150, bingoCards.length)}
            </button>
          )}
          <span className="text-sm font-bold text-gray-300">
            Selected: {Array.isArray(cartelaIds) ? cartelaIds.length : 0}/{MAX_CARDS_ALLOWED}
          </span>
        </div>

          {announcement && (
            <div className={`w-full p-3 rounded-lg mb-3 text-center text-sm font-medium ${
                announcement.type === "warning" 
                    ? "bg-yellow-100 text-yellow-800 border border-yellow-300" 
                    : "bg-blue-100 text-blue-800 border border-blue-300"
            }`}>
                ⚠️ {announcement.message}
                <button 
                    className="ml-3 text-xs underline opacity-70"
                    onClick={() => setAnnouncement(null)}
                >
                    dismiss
                </button>
            </div>
        )}

        {/* Card grid */}
        <div className="grid grid-cols-10 gap-1 py-1 px-2 max-w-lg w-full text-xs">
          {cardsForCurrentPage.map((card) => {
            const isMyCard    = Array.isArray(cartelaIds) && cartelaIds.map(Number).includes(Number(card.id));
            const isOtherCard = otherSelectedCards && Object.entries(otherSelectedCards).some(
              ([ownerId, cardArray]) => String(ownerId) !== String(telegramId) && cardArray.includes(Number(card.id))
            );
            return (
              <button key={card.id} onClick={() => handleNumberClick(card.id)} disabled={isOtherCard}
                className={`w-8 h-8 flex items-center justify-center rounded-md border border-gray-300 font-bold cursor-pointer transition-all duration-200 text-xs
                  ${isMyCard ? myCardBg : isOtherCard ? otherCardBg : defaultCardBg}
                  ${isOtherCard ? "opacity-80 scale-95 shadow-inner" : "hover:scale-105 active:scale-90"}`}>
                {card.id}
              </button>
            );
          })}
        </div>

        {/* Selected cards + action buttons */}
        <div className="flex gap-3 items-start mt-4 flex-wrap justify-center">
          {selectedCartelas.map((cardData, cardIndex) => (
            <div key={cardIndex} className="flex flex-col items-center">
              <h4 className="text-sm font-semibold mb-1">Card #{cardData.id}</h4>
              <div className="grid grid-cols-5 gap-1 p-1 bg-transparent text-white border-2 border-green-500 rounded-lg">
                {cardData.card.flat().map((num, index) => (
                  <div key={index} className={`w-6 h-6 flex items-center justify-center border border-white rounded-lg text-xs font-bold ${cellBg}`}>
                    {num}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-2 mt-2 self-end">
            <button onClick={resetGame} className={`${refreshBtnBg} text-white px-3 py-1 rounded-lg shadow-md text-sm`}>
              Refresh
            </button>
            <button
              onClick={startGame}
              disabled={!Array.isArray(cartelaIds) || cartelaIds.length === 0 || isStarting || gameStarted || emitLockRef.current}
              className={`${!Array.isArray(cartelaIds) || cartelaIds.length === 0 || isStarting ? startBtnDisabledBg : startBtnEnabledBg} text-white px-3 py-1 rounded-lg shadow-md text-sm`}>
              {isStarting ? "Starting..." : `Start Game (${Array.isArray(cartelaIds) ? cartelaIds.length : 0} Card${Array.isArray(cartelaIds) && cartelaIds.length !== 1 ? "s" : ""})`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default Bingo;
