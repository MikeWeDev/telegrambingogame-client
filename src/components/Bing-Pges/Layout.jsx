// components/Bing-Pges/Layout.jsx
import React, { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Nav from "./NavLink";

// ✅ UPDATED: Received cartelaIds (plural) instead of cartelaId
export default function Layout({ 
  isBlackToggleOn, 
  socket, 
  gameId, 
  telegramId, 
  cartelaIds, 
  onClearClientCardState 
}) {
  const location = useLocation();
  const prevPathRef = useRef(null);

  useEffect(() => {
    const currentPath = location.pathname;
    const prevPath = prevPathRef.current;
    console.log("🧭 LAYOUT: route check - currentPath:", currentPath, "prevPath:", prevPath);

    const isEnteringRoot = currentPath === "/" && prevPath !== "/";
    // Check if we are leaving the home page to a page that IS NOT the game
    const isLeavingRootToNonGame = prevPath === "/" && currentPath !== "/" && !currentPath.startsWith("/game");
    console.log("🧭 LAYOUT: isEnteringRoot:", isEnteringRoot, "isLeavingRootToNonGame:", isLeavingRootToNonGame);

    // --- 1. Clear session storage ONLY when entering "/" (Soft Reload) ---
    if (isEnteringRoot) {
      //console.log("Layout: Navigating back to /, performing soft reload and clearing session storage.");
      
      // ✅ FIX: Use the plural key
      sessionStorage.removeItem("mySelectedCardIds"); 
      sessionStorage.removeItem("hasRefreshed_/");
      
      // ✅ FIX: Call the cleanup function
      if (typeof onClearClientCardState === "function") {
        onClearClientCardState(); 
      }
    }


    // --- 2. Emit only when leaving "/" to a NON-/game route (via React Router) ---
    // FIX: Exclude /game/* routes — navigating INTO a game should NOT unselect cards.
    // The game page needs the card to remain held on the server so other players see it taken.
    if (isLeavingRootToNonGame && !currentPath.startsWith("/game")) {
      console.log("✅ LAYOUT EMIT: unselectCardOnLeave on route change!");
      if (socket && socket.connected) {
        socket.emit("unselectCardOnLeave", {
          gameId,
          telegramId,
        });

        // ✅ FIX: Call the cleanup function immediately
        if (typeof onClearClientCardState === "function") {
          onClearClientCardState();
        }
      } else {
        console.warn("Layout: Socket not connected or not available for emit on route change.");
      }
    }

    prevPathRef.current = currentPath;


    // --- 3. Emit ONLY if closing tab/refreshing while on "/" AND card was selected ---
    // FIX: Only emit if user actually held a card (non-empty cartelaIds).
    // Guard against firing on every state-change re-render (React StrictMode double-invoke etc.)
    const handleBeforeUnload = () => {
      if (location.pathname === "/" && Array.isArray(cartelaIds) && cartelaIds.length > 0) {
        console.log("📤 LAYOUT EMIT: unselectCardOnLeave on beforeunload!");
        if (socket && socket.connected) {
          socket.emit("unselectCardOnLeave", {
            gameId,
            telegramId,
          });

          // ✅ FIX: Call cleanup
          if (typeof onClearClientCardState === "function") {
             onClearClientCardState();
          }
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
    // ✅ FIX: Updated dependencies to include cartelaIds (array)
  }, [location.pathname, gameId, telegramId, cartelaIds, socket, onClearClientCardState]); 

  return (
    <>
      <Outlet />
      <Nav isBlackToggleOn={isBlackToggleOn} />
    </>
  );
}