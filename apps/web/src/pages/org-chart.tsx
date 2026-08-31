import * as React from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';

interface Node {
  id: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  directReports: Node[];
}

export function OrgChartPage() {
  const [roots, setRoots] = React.useState<Node[]>([]);

  React.useEffect(() => {
    api.get<Node[]>('/employees/org-chart').then(setRoots);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Org chart</h1>
        <p className="text-sm text-muted-foreground">Reporting hierarchy across the company.</p>
      </div>
      <Card className="p-5">
        <ul className="flex flex-col gap-1">
          {roots.map((n) => (
            <TreeNode key={n.id} node={n} depth={0} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function TreeNode({ node, depth }: { node: Node; depth: number }) {
  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-md py-1.5 text-sm"
        style={{ paddingLeft: depth * 24 }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="font-medium">
          {node.firstName} {node.lastName}
        </span>
        {node.designation && <span className="text-muted-foreground">· {node.designation}</span>}
      </div>
      {node.directReports.length > 0 && (
        <ul>
          {node.directReports.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
