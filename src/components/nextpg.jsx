import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import socket from "../../socket"; // ✅ Shared socket instance

const BingoCell = React.memo(({ num, isFreeSpace, isSelected, onClick }) => {
  return (
    <div
      onClick={onClick}
      className={`md:w-10 md:h-10 w-8 h-8 flex items-center justify-center font-extrabold text-md sm:text-lg border rounded-lg shadow-md cursor-pointer transition
        ${
          isFreeSpace
            ? "bg-gradient-to-b from-green-400 to-green-600 text-white"
            : isSelected
            ? "bg-gradient-to-b from-green-400 to-green-600 text-white"
            : "bg-white text-black"
        }`}
    >
      {isFreeSpace ? "⭐" : num}
    </div>
  );
});

const BingoGame = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const { cartela, cartelaId, gameId, telegramId, GameSessionId, selectedCartelas } = location.state || {};

  const bingoColors = {
    B: "bg-yellow-500",
    I: "bg-green-500",
    N: "bg-blue-500",
    G: "bg-red-500",
    O: "bg-purple-500",
  };

  const [randomNumber,            setRandomNumber]            = useState([]);
  const [calledNumbers,           setCalledNumbers]           = useState([]);
  const [currentCall,             setCurrentCall]             = useState(null);
  const [selectedNumbers,         setSelectedNumbers]         = useState(new Set());
  const [countdown,               setCountdown]               = useState(0);
  const [calledSet,               setCalledSet]               = useState(new Set());
  const [lastWinnerCells,         setLastWinnerCells]         = useState([]);
  const [playerCount,             setPlayerCount]             = useState(0);
  const [gameStarted,             setGameStarted]             = useState(false);
  const [winnerFound,             setWinnerFound]             = useState(false);
  const [hasEmittedGameCount,     setHasEmittedGameCount]     = React.useState(false);
  const [gracePlayers,            setGracePlayers]            = useState([]);
  const [isGameEnd,               setIsGameEnd]               = useState(false);
  const [callNumberLength,        setCallNumberLength]        = useState(0);
  const [isAudioOn,               setIsAudioOn]               = useState(false);
  const [audioPrimed,             setAudioPrimed]             = useState(false);
  const [failedBingo,             setFailedBingo]             = useState(null);
  const [lastCalledLabel,         setLastCalledLabel]         = useState(null);
  const [isForceEnded,     setIsForceEnded]     = useState(false);
  const [forceEndMessage,  setForceEndMessage]  = useState("");
  const [autoLeaveCountdown,      setAutoLeaveCountdown]      = useState(3);
  const [lobbyReady, setLobbyReady] = useState(true);
  const saveTimeout     = useRef(null);
  const autoLeaveTimeout = useRef(null);

  // Multi-board states
  const [activeBoards,            setActiveBoards]            = useState([]);
  const [selectedNumbersPerBoard, setSelectedNumbersPerBoard] = useState({});

  const [gameDetails, setGameDetails] = useState({
    winAmount:        '-',
    playersCount:     '-',
    stakeAmount:      '-',
    cardCount:        '-',
    totalDrawingLength: '-',
    isHouseCutFree:   '-',
  });

  // ─── FIX P2: Reconnect overlay state ─────────────────────────────────────
  const [socketConnected,  setSocketConnected]  = useState(socket?.connected ?? true);
  const [reconnectSeconds, setReconnectSeconds] = useState(0);
  const reconnectTimerRef = useRef(null);

  const hasJoinedRef = useRef(false);
  const playedAudioRef = useRef(new Set());

  // ─── FIX P2: Rate-limit ref for gameCount emit ────────────────────────────
  // Prevents the client emitting gameCount repeatedly if re-renders fire quickly.
  // A 10-second cooldown is sufficient — the server also has its own Redis lock.
  const lastGameCountEmitRef = useRef(0);
  const GAME_COUNT_COOLDOWN_MS = 10_000;

  // Initialize boards
  useEffect(() => {
    if (selectedCartelas && selectedCartelas.length > 0) {
      const formattedBoards = selectedCartelas.map(board => ({
        cartelaId: board.id,
        cartela:   board.card
      }));
      setActiveBoards(formattedBoards);
      const initialSelections = {};
      formattedBoards.forEach(board => { initialSelections[board.cartelaId] = new Set(); });
      setSelectedNumbersPerBoard(initialSelections);
      if (formattedBoards.length === 1) setSelectedNumbers(new Set());

    } else if (cartelaId && cartela) {
      setActiveBoards([{ cartelaId, cartela }]);
      setSelectedNumbersPerBoard({ [cartelaId]: new Set() });
      setSelectedNumbers(new Set());
    }
  }, [cartelaId, cartela, selectedCartelas]);

  // Auto leave countdown when game ends
  useEffect(() => {
    if (isGameEnd) {
      setAutoLeaveCountdown(3);
      const timer = setInterval(() => {
        setAutoLeaveCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
              socket.emit("playerLeave", { gameId: String(gameId), GameSessionId, telegramId });
              console.log("Auto leaving game after game end");
              navigate("/");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [isGameEnd, gameId, GameSessionId, telegramId, navigate]);

  // ─── Stable isAudioOn ref so it can be read inside the socket effect
  // without adding it to the dependency array (which would cause
  // unnecessary listener re-registration on every audio toggle) ───────────────
  const isAudioOnRef = useRef(isAudioOn);
  useEffect(() => { isAudioOnRef.current = isAudioOn; }, [isAudioOn]);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    if (!hasJoinedRef.current && gameId && telegramId) {
      hasJoinedRef.current = true;
      const initData = window.Telegram?.WebApp?.initData;
      if (initData) {
        socket.emit("userJoinedGame", { initData, gameId });
        setTimeout(() => {
          socket.emit("joinGame", { gameId, telegramId, GameSessionId });
        }, 500);
      } else {
        socket.emit("joinGame", { gameId, telegramId, GameSessionId });
      }
    }

    const handleSocketDisconnect = () => {
      setSocketConnected(false);
      let secs = 0;
      reconnectTimerRef.current = setInterval(() => {
        secs += 1;
        setReconnectSeconds(secs);
      }, 1000);
    };

    const handleSocketConnect = () => {
      console.log("✅ Socket.IO connected or reconnected!");
      setSocketConnected(true);
      setReconnectSeconds(0);
      if (reconnectTimerRef.current) {
        clearInterval(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (gameId && telegramId) {
        const initData = window.Telegram?.WebApp?.initData;
        if (initData) {
          socket.emit("userJoinedGame", { initData, gameId });
          setTimeout(() => {
            socket.emit("joinGame", { gameId, telegramId, GameSessionId });
          }, 500);
        } else {
          socket.emit("joinGame", { gameId, telegramId, GameSessionId });
        }
      }
    };

    const handlePlayerCountUpdate = ({ playerCount }) => setPlayerCount(playerCount);
    const handleCountdownTick = ({ countdown }) => setCountdown(countdown);
    const handleGameStart = () => setGameStarted(true);
    const handleGameEnd = () => { console.log("gameEnd called"); setIsGameEnd(true); };

    const handleGameReset = () => {
      console.log("🔄 Game reset received, allowing new gameCount emit");
      setLobbyReady(false);
      setHasEmittedGameCount(false);
      lastGameCountEmitRef.current = 0;
      setRandomNumber([]);
      setCalledSet(new Set());
      setSelectedNumbers(new Set());
      setSelectedNumbersPerBoard({});
      setCountdown(0);
      setGameStarted(false);
      setLastCalledLabel(null);
      setAutoLeaveCountdown(3);
      setWinnerFound(false);
      setCallNumberLength(0);
      setCalledNumbers([]);
      setCurrentCall(null);
      playedAudioRef.current = new Set();
      localStorage.removeItem(`mySelectedCardIds:${gameId}`);
    };

    const handleDrawnNumbersHistory = ({ gameId: receivedGameId, history }) => {
      if (receivedGameId === gameId) {
        const numbers = history.map(item => item.number);
        const labels  = new Set(history.map(item => item.label));
        setRandomNumber(numbers);
        setCalledSet(labels);
        if (history.length > 0) setLastCalledLabel(history[history.length - 1].label);
        // Mark all historical numbers as already played so live numberDrawn won't re-trigger audio
        numbers.forEach(n => playedAudioRef.current.add(n));
      }
    };

    const handleNumberDrawn = ({ number, label, callNumberLength: cnl }) => {
      console.log("⭐⭐ numbers drawn", number);
      setCurrentCall(prev => {
        if (prev?.number === number) return prev;
        return { number, label };
      });
      setRandomNumber(prev => {
        if (prev.includes(number)) return prev;
        return [...prev, number];
      });
      setCalledSet(prev => new Set(prev).add(label));
      setCallNumberLength(cnl);
      setLastCalledLabel(label);
      if (isAudioOnRef.current) playAudioForNumber(number);
    };

    const handleBingoClaimFailed = ({ message, reason, telegramId: tId, gameId: gId, cardId, card, lastTwoNumbers, selectedNumbers }) => {
      navigateRef.current("/winnerFailed", {
        state: { message, reason, telegramId: tId, gameId: gId, cardId, card, lastTwoNumbers, selectedNumbers }
      });
    };

    const handleGameDetails = ({ winAmount, playersCount, cardCount, stakeAmount, totalDrawingLength, isHouseCutFree }) => {
      setGameDetails({ winAmount, playersCount, stakeAmount, cardCount, totalDrawingLength, isHouseCutFree });
    };

    const handleWinnerConfirmed = ({ winnerName, prizeAmount, board, winnerPattern, boardNumber, playerCount, telegramId: wTId, gameId: wGId, GameSessionId: wSid }) => {
      navigateRef.current("/winnerPage", { state: { winnerName, prizeAmount, board, winnerPattern, boardNumber, playerCount, telegramId: wTId, gameId: wGId, GameSessionId: wSid } });
    };

    const handleWinnerError = () => {
      socket.emit("playerLeave", { gameId: String(gameId), GameSessionId, telegramId }, () => {
        console.log("player leave emitted after winnerError");
        navigateRef.current("/");
      });
    };

    const handleForceEnd = ({ message }) => {
      setForceEndMessage(message || "This game has been terminated by an administrator.");
      setIsForceEnded(true);
      setTimeout(() => {
        socket.emit("playerLeave", { gameId: String(gameId), GameSessionId, telegramId });
        navigateRef.current("/");
      }, 5000);
    };

    const handleLobbyReady = () => { setLobbyReady(true); };

    // ── Register all listeners ────────────────────────────────────────────
    socket.on("connect", handleSocketConnect);
    socket.on("disconnect", handleSocketDisconnect);
    socket.on("playerCountUpdate", handlePlayerCountUpdate);
    socket.on("countdownTick", handleCountdownTick);
    socket.on("gameStart", handleGameStart);
    socket.on("gameEnd", handleGameEnd);
    socket.on("gameReset", handleGameReset);
    socket.on("drawnNumbersHistory", handleDrawnNumbersHistory);
    socket.on("numberDrawn", handleNumberDrawn);
    socket.on("gameDetails", handleGameDetails);
    socket.on("winnerConfirmed", handleWinnerConfirmed);
    socket.on("winnerError", handleWinnerError);
    socket.on("bingoClaimFailed", handleBingoClaimFailed);
    socket.on("force_game_end", handleForceEnd);
    socket.on("lobbyReady", handleLobbyReady);

    // ── Cleanup: remove every listener we registered ──────────────────────
    return () => {
      socket.off("connect", handleSocketConnect);
      socket.off("disconnect", handleSocketDisconnect);
      socket.off("playerCountUpdate", handlePlayerCountUpdate);
      socket.off("countdownTick", handleCountdownTick);
      socket.off("gameStart", handleGameStart);
      socket.off("gameEnd", handleGameEnd);
      socket.off("gameReset", handleGameReset);
      socket.off("drawnNumbersHistory", handleDrawnNumbersHistory);
      socket.off("numberDrawn", handleNumberDrawn);
      socket.off("gameDetails", handleGameDetails);
      socket.off("winnerConfirmed", handleWinnerConfirmed);
      socket.off("winnerError", handleWinnerError);
      socket.off("bingoClaimFailed", handleBingoClaimFailed);
      socket.off("force_game_end", handleForceEnd);
      socket.off("lobbyReady", handleLobbyReady);
      if (autoLeaveTimeout.current) clearTimeout(autoLeaveTimeout.current);
      if (reconnectTimerRef.current) clearInterval(reconnectTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, telegramId, GameSessionId]);

  const playAudioForNumber = (number) => {
    if (!isAudioOnRef.current) return;
    if (playedAudioRef.current.has(number)) return;
    playedAudioRef.current.add(number);
    const audio = new Audio(`/audio/audio${number}.mp3`);
    audio.currentTime = 0;
    audio.play().catch((error) => console.error(`🔊 Failed to play audio ${number}:`, error));
  };

  // ─── FIX P2: Rate-limited gameCount emit ─────────────────────────────────
  // Original: emits gameCount as soon as playerCount >= 2 with no throttle.
  // A rapid sequence of playerCountUpdate events (common when multiple players
  // join within the same second) could fire gameCount multiple times before
  // hasEmittedGameCount becomes true (due to async state updates).
  // Fix: use a ref-based cooldown that is synchronously updated before emit,
  // so even synchronous batched renders cannot double-fire it.
  useEffect(() => {
    if (
      playerCount >= 2 &&
      !hasEmittedGameCount &&
      lobbyReady && 
      !gameStarted
    ) {
      const now = Date.now();
      if (now - lastGameCountEmitRef.current < GAME_COUNT_COOLDOWN_MS) {
        console.log("⏸ gameCount skipped: cooldown active");
        return;
      }
      lastGameCountEmitRef.current = now;
      console.log("✅ Emitting gameCount to server...");
      socket.emit("gameCount", { gameId, GameSessionId });
      setHasEmittedGameCount(true);
    }
  }, [playerCount, gameStarted, hasEmittedGameCount, gameId, gracePlayers]);


  // Cross-board number sync
  const handleCartelaClick = (num, boardId) => {
    if (!selectedNumbersPerBoard[boardId]) return;

    setSelectedNumbersPerBoard(prev => {
      const newSelections       = { ...prev };
      const currentBoardSelections = new Set(prev[boardId] || []);
      if (currentBoardSelections.has(num)) currentBoardSelections.delete(num);
      else currentBoardSelections.add(num);
      newSelections[boardId] = currentBoardSelections;

      activeBoards.forEach(board => {
        if (board.cartelaId !== boardId) {
          const numberExistsInBoard = board.cartela.flat().includes(num);
          if (numberExistsInBoard) {
            const otherBoardSelections = new Set(prev[board.cartelaId] || []);
            if (currentBoardSelections.has(num)) otherBoardSelections.add(num);
            else otherBoardSelections.delete(num);
            newSelections[board.cartelaId] = otherBoardSelections;
          }
        }
      });
      return newSelections;
    });

    if (activeBoards.length === 1) {
      const newSelection = new Set(selectedNumbers);
      if (newSelection.has(num)) newSelection.delete(num);
      else newSelection.add(num);
      setSelectedNumbers(newSelection);
    }

    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      localStorage.setItem("selectedNumbers", JSON.stringify([...selectedNumbers]));
      localStorage.setItem("selectedNumbersPerBoard", JSON.stringify(
        Object.fromEntries(
          Object.entries(selectedNumbersPerBoard).map(([id, set]) => [id, [...set]])
        )
      ));
    }, 300);
  };

  const checkForWin = (boardId) => {
    let selectedSet;
    let boardCartelaId;

    if (activeBoards.length === 1 && activeBoards[0]) {
      selectedSet    = selectedNumbersPerBoard[activeBoards[0].cartelaId] || new Set();
      boardCartelaId = activeBoards[0].cartelaId;
    } else {
      selectedSet    = selectedNumbersPerBoard[boardId] || new Set();
      boardCartelaId = boardId;
    }

    const selectedArray = Array.from(selectedSet);

    socket.emit("checkWinner", {
      telegramId,
      gameId,
      GameSessionId,
      cartelaId:       boardCartelaId,
      selectedNumbers: selectedArray,
    });

    console.log("Sending to backend:", { telegramId, gameId, cartelaId: boardCartelaId, selectedNumbers: selectedArray });
  };

  // ─── Stable navigate ref so the main socket effect doesn't re-register
  // listeners on every navigation state change ─────────────────────────────────
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  useEffect(() => {
    if (!socket) return;

    const handleGameStateSync = (state) => {
      // Handle game state sync if needed
    };

    const handleYouAreWinner = (winnerData) => {
      navigateRef.current("/winner", { state: winnerData });
    };

    socket.on("gameStateSync", handleGameStateSync);
    socket.on("youAreWinner", handleYouAreWinner);

    return () => {
      socket.off("gameStateSync", handleGameStateSync);
      socket.off("youAreWinner", handleYouAreWinner);
    };
  }, [socket]);

  // Load saved audio state on mount
  useEffect(() => {
    const savedAudioState = localStorage.getItem("isAudioOn");
    if (savedAudioState !== null) setIsAudioOn(savedAudioState === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem("isAudioOn", isAudioOn);
  }, [isAudioOn]);

  return (
    <div className="bg-gradient-to-b from-[#1a002b] via-[#2d003f] to-black min-h-screen flex flex-col items-center p-1 pb-3 w-full max-w-screen overflow-hidden">

      {/* ─── FIX P2: Reconnect overlay ─────────────────────────────────────── */}
      {!socketConnected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8 max-w-xs w-full text-center">
            <div className="text-4xl mb-4 animate-spin">🔄</div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-2">Reconnecting...</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Connection lost ({reconnectSeconds}s). Reconnecting automatically...
            </p>
            <p className="text-xs text-gray-400 mt-2">Your cards and game progress are safe.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-6 sm:grid-cols-6 gap-0.5 w-full text-white text-center mt-0 mb-1">
        {[
          `Players: ${gameDetails.cardCount}`,
          `Win ${gameDetails.winAmount}`,
          `ጥሪ: ${callNumberLength}`,
          `ባለ: ${gameDetails.stakeAmount}`,
          `ቦነስ: ${gameDetails.isHouseCutFree === true ? "On" : "off"}`,
        ].map((info, i) => (
          <button key={i} className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black font-bold p-1 text-xs rounded w-full">
            {info}
          </button>
        ))}
        <button
          onClick={() => {
            if (!isAudioOn) {
              const audio = new Audio(`audio/audio1.mp3`);
              audio.volume = 0;
              audio.play().then(() => {
                audio.pause();
                audio.currentTime = 0;
                console.log("✅ Audio unlocked");
                setIsAudioOn(true);
              }).catch((err) => {
                console.warn("❌ Audio unlock failed:", err);
                alert("Audio could not be enabled. Please try clicking again.");
              });
            } else {
              setIsAudioOn(false);
            }
          }}
          className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black font-bold p-1 text-xs rounded w-full"
        >
          {`${isAudioOn ? "🔊" : "🔇"}`}
        </button>
      </div>

      <div className={`flex w-full mt-1 ${activeBoards.length > 1 ? 'gap-3' : ''}`}>
        {/* Column 1: Controls and Number Grid */}
        <div className="w-[45%] flex flex-col">
          {activeBoards.length <= 1 ? (
            <div className="grid grid-cols-5 bg-[#2a0047] p-1 gap-2 rounded-lg text-xs w-[90%]">
              {["B", "I", "N", "G", "O"].map((letter, i) => (
                <div key={i} className={`text-white text-center text-xs font-bold rounded-full h-4 w-6 ${bingoColors[letter]}`}>
                  {letter}
                </div>
              ))}
              {[...Array(15)].map((_, rowIndex) =>
                ["B", "I", "N", "G", "O"].map((letter, colIndex) => {
                  const number          = rowIndex + 1 + colIndex * 15;
                  const randomNumberLabel = `${letter}-${number}`;
                  return (
                    <div key={randomNumberLabel} className={`text-center rounded ${calledSet.has(randomNumberLabel) ? "bg-gradient-to-b from-yellow-400 to-orange-500 text-black" : "bg-gray-800 text-gray-400 font-bold"}`}>
                      {number}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1 h-full">
              <div className="flex flex-row gap-2 w-full justify-center">
                <div className="bg-gray-300 p-2 rounded-lg text-center w-1/2 flex items-center justify-center">
                  <p className="text-xl font-bold">{countdown > 0 ? countdown : "Wait"}</p>
                </div>
                <div className="bg-gradient-to-b from-purple-800 to-purple-900 rounded-lg text-white flex items-center justify-center w-1/2 p-1">
                  <div className="w-12 h-12 flex items-center justify-center text-md font-extrabold rounded-full shadow-[0_0_15px_#37ebf3] bg-[#37ebf3] text-purple-900">
                    {lastCalledLabel ? lastCalledLabel : "-"}
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-b from-gray-800 to-gray-900 p-2 rounded-lg w-full">
                <p className="text-center font-bold text-xs text-yellow-400 mb-1">Recent Calls</p>
                <div className="flex justify-center gap-2">
                  {randomNumber.slice(-3).map((num, index) => {
                    const colors = ["bg-red-800", "bg-green-800", "bg-blue-800"];
                    return (
                      <div key={index} className={`w-6 h-6 flex items-center justify-center text-xs font-extrabold rounded-full text-white ${colors[index]}`}>
                        {num}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex-1 grid grid-cols-5 bg-[#2a0047] p-1 gap-2 rounded-lg text-xs w-full">
                {["B", "I", "N", "G", "O"].map((letter, i) => (
                  <div key={i} className={`text-white text-center text-xs font-bold rounded-full h-4 w-6 ${bingoColors[letter]}`}>{letter}</div>
                ))}
                {[...Array(15)].map((_, rowIndex) =>
                  ["B", "I", "N", "G", "O"].map((letter, colIndex) => {
                    const number          = rowIndex + 1 + colIndex * 15;
                    const randomNumberLabel = `${letter}-${number}`;
                    return (
                      <div key={randomNumberLabel} className={`text-center rounded ${calledSet.has(randomNumberLabel) ? "bg-gradient-to-b from-yellow-400 to-orange-500 text-black" : "bg-gray-800 text-gray-400 font-bold"}`}>
                        {number}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Column 2: Boards */}
        <div className="w-[55%] flex flex-col">
          {activeBoards.length <= 1 ? (
            <div className="flex flex-col items-center gap-1">
              <div className="bg-gray-300 p-2 rounded-lg text-center text-xs w-[90%] flex-row flex items-center h-[7%] justify-around">
                <p>Countdown</p>
                <p className="text-lg font-bold">{countdown > 0 ? countdown : "Wait"}</p>
              </div>
              <div className="bg-gradient-to-b from-purple-800 to-purple-900 rounded-lg text-white flex flex-row justify-around items-center w-full max-w-md mx-auto">
                <p className="font-bold text-xs">Current Number</p>
                <div className="flex justify-center items-center gap-4">
                  <div className="w-14 h-14 flex items-center justify-center text-xl font-extrabold rounded-full shadow-[0_0_20px_#37ebf3] bg-[#37ebf3] text-purple-900">
                    {lastCalledLabel ? lastCalledLabel : "-"}
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-b from-gray-800 to-gray-900 p-2 rounded-lg w-full max-w-md mx-auto">
                <p className="text-center font-bold text-xs sm:text-sm text-yellow-400 md:text-base mb-1">Recent Calls</p>
                <div className="flex justify-center gap-2 sm:gap-4">
                  {randomNumber.slice(-4, -1).map((num, index) => {
                    const colors = ["bg-red-800", "bg-green-800", "bg-blue-800"];
                    return (
                      <div key={index} className={`w-6 h-6 sm:w-6 sm:h-6 md:w-6 md:h-6 flex items-center justify-center text-base text-xs md:text-sm font-extrabold rounded-full shadow-xl text-white ${colors[index]}`}>
                        {num}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Single Board Layout */}
              <div className="w-full">
                <div className="space-y-4">
                  <div className="bg-gradient-to-b from-purple-800 to-purple-900 p-4 rounded-lg w-full max-w-md mx-auto">
                    <h4 className="text-center text-yellow-400 text-lg font-bold mb-2">
                      Card #{activeBoards[0]?.cartelaId}
                    </h4>
                    <div className="grid grid-cols-5 gap-1 mb-2">
                      {["B", "I", "N", "G", "O"].map((letter, i) => (
                        <div key={i} className={`w-8 h-8 flex items-center justify-center font-bold text-white text-sm rounded-full ${bingoColors[letter]}`}>
                          {letter}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-5 gap-1">
                      {activeBoards[0]?.cartela.map((row, rowIndex) =>
                        row.map((num, colIndex) => {
                          const isFreeSpace  = rowIndex === 2 && colIndex === 2;
                          const isSelectedNum = (selectedNumbersPerBoard[activeBoards[0].cartelaId] || new Set()).has(num);
                          return (
                            <BingoCell
                              key={`${activeBoards[0].cartelaId}-${rowIndex}-${colIndex}`}
                              num={num}
                              isFreeSpace={isFreeSpace}
                              isSelected={isSelectedNum}
                              onClick={() => handleCartelaClick(num, activeBoards[0].cartelaId)}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 h-full">
              <div className="flex-1 flex flex-col gap-3">
                {activeBoards.map((board, boardIndex) => {
                  const isSelected = (selectedNumbersPerBoard[board.cartelaId] || new Set());
                  return (
                    <div key={board.cartelaId} className="bg-gradient-to-b from-purple-800 to-purple-900 p-2 rounded-lg w-full flex-1">
                      <div className="text-center text-yellow-400 text-sm mb-1 font-bold">
                        Card #{board.cartelaId}
                      </div>
                      <div className="grid grid-cols-5 gap-0.5 mb-1">
                        {["B", "I", "N", "G", "O"].map((letter, i) => (
                          <div key={i} className={`w-8 h-5 flex items-center justify-center font-bold text-white text-sm rounded-full ${bingoColors[letter]}`}>
                            {letter}
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {board.cartela.map((row, rowIndex) =>
                          row.map((num, colIndex) => {
                            const isFreeSpace   = rowIndex === 2 && colIndex === 2;
                            const isSelectedNum = isSelected.has(num);
                            return (
                              <BingoCell
                                key={`${board.cartelaId}-${rowIndex}-${colIndex}`}
                                num={num}
                                isFreeSpace={isFreeSpace}
                                isSelected={isSelectedNum}
                                onClick={() => handleCartelaClick(num, board.cartelaId)}
                              />
                            );
                          })
                        )}
                      </div>
                      <button
                        onClick={() => checkForWin(board.cartelaId)}
                        className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 px-2 py-1 text-white rounded-4xl text-xs font-bold shadow-lg transition-all duration-200 mt-2"
                      >
                        BINGO!
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom buttons */}
      <div className="w-full flex flex-col items-center gap-3 mt-3">
        {activeBoards.length === 1 && activeBoards[0] && (
          <button
            onClick={() => checkForWin(activeBoards[0].cartelaId)}
            className="w-full max-w-md bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 px-4 py-3 text-white rounded-4xl text-lg font-bold shadow-lg transition-all duration-200"
          >
            BINGO!
          </button>
        )}
        <div className="w-full flex gap-3 justify-center">
          <button
            className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 px-14 h-10 text-white rounded-full text-sm font-semibold shadow-md transition-all duration-200"
            onClick={() => {
              if (gameId && telegramId) {
                socket.emit("joinGame", { gameId, telegramId, GameSessionId });
                console.log("Forced refresh: Re-emitted joinGame to synchronize state.");
              } else {
                console.warn("Cannot force refresh: gameId or telegramId missing.");
                window.location.reload();
              }
            }}
          >
            Refresh
          </button>
          <button
            onClick={() => {
              localStorage.removeItem(`mySelectedCardIds:${gameId}`);
              socket.emit("playerLeave", { gameId: String(gameId), GameSessionId, telegramId }, () => {
                console.log("player leave emitted", GameSessionId);
                navigate("/");
              });
            }}
            className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 px-14 h-10 text-white rounded-full text-sm font-semibold shadow-md transition-all duration-200"
          >
            Leave
          </button>
        </div>
      </div>

      {isGameEnd && (
        <div className="fixed inset-0 flex items-center justify-center bg-opacity-80 backdrop-blur-sm z-50 transition-opacity duration-300">
          <div className="bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-6">🎉 Game Over</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              The game has ended. Automatically leaving in {autoLeaveCountdown} seconds...
            </p>
            <button
              className="w-1/2 bg-gradient-to-r from-green-500 to-emerald-600 px-4 py-2 text-white rounded-lg text-lg font-semibold shadow-md"
              onClick={() => {
                socket.emit("playerLeave", { gameId: String(gameId), GameSessionId, telegramId }, () => {
                  console.log("player leave emitted", GameSessionId);
                  navigate("/");
                });
              }}
            >
              Leave Now
            </button>
          </div>
        </div>
      )}

      {isForceEnded && (
    <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-50">
        <div className="bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center">
            <div className="text-4xl mb-4">🛑</div>
            <h2 className="text-2xl font-bold text-red-600 mb-4">Game Terminated</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{forceEndMessage}</p>
            <p className="text-sm text-gray-400">Redirecting in 5 seconds...</p>
        </div>
    </div>
    )}
    </div>
  );
};

export default BingoGame;
