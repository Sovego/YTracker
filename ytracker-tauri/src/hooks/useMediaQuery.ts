/**
 * React hook helpers for media-query driven responsive behavior.
 */
import { useEffect, useState } from "react";

/**
 * Subscribes to a media query and returns whether it currently matches.
 */
export function useMediaQuery(query: string) {
    const getMatches = () => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
            return false;
        }
        return window.matchMedia(query).matches;
    };

    const [matches, setMatches] = useState(getMatches);

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
            return;
        }

        const mediaQueryList = window.matchMedia(query);
        const listener = (event: MediaQueryListEvent) => {
            setMatches(event.matches);
        };

        // Support older browsers
        if (typeof mediaQueryList.addEventListener === "function") {
            mediaQueryList.addEventListener("change", listener);
        } else {
            mediaQueryList.addListener(listener);
        }

        // Set the initial state in case the query changed before the effect ran
        setMatches(mediaQueryList.matches);

        return () => {
            if (typeof mediaQueryList.removeEventListener === "function") {
                mediaQueryList.removeEventListener("change", listener);
            } else {
                mediaQueryList.removeListener(listener);
            }
        };
    }, [query]);

    return matches;
}
