import { useState, useEffect } from "react";
import { ApiCall } from "@/utils/api";

export const useServiceWorker = () => {
    const [registration, setRegistration] = useState<ServiceWorkerRegistration | undefined>(undefined);

    const register = async () => {
        const reg = await navigator.serviceWorker.register(
            "/service_worker.js",
            { scope: "/" },
        );
        setRegistration(reg);
    };

    useEffect(() => {
        register();
    }, []);

    const subscribe = async (domain: string) => {
        if (registration) {
            const applicationServerKey = await ApiCall(domain).notification.publicKey();
            const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
            await ApiCall(domain).notification.subscribe(subscription);
        }
    };

    return {
        subscribe,
    };
};
