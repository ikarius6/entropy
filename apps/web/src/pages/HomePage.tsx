import { Feed } from "../components/feed/Feed";
import { useEntropyStore } from "../stores/entropy-store";

export default function HomePage() {
  const { pubkey } = useEntropyStore();

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">
      <div className="panel flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Feed</h1>
        {!pubkey && (
          <p className="text-muted">Welcome to Entropy. Connect your node to see the latest content from your network.</p>
        )}
      </div>
      
      <Feed />
    </div>
  );
}
